/**
 * Report controller
 * Handles all report-related operations
 */

import { Prisma, PrismaClient, type Report } from '@docphone/db';
import type { PaginatedResponse, ReportResponse } from '@docphone/shared';
import type { WorkflowState } from '@docphone/shared/types';
import { NextFunction, Request, Response } from 'express';
import { AppError } from '../middlewares/errorHandler.js';
import { AiService } from '../services/AiService.js';
import { AuditService } from '../services/AuditService.js';
import { AuthorizationService } from '../services/AuthorizationService.js';
import { ImageAnalysisJobService } from '../services/ImageAnalysisJobService.js';
import { PdfService } from '../services/PdfService.js';
import { RealtimeService } from '../services/RealtimeService.js';
import { RedisService } from '../services/RedisService.js';
import { ReportLifecycleService } from '../services/ReportLifecycleService.js';
import { StorageService } from '../services/StorageService.js';
import { UserResolverService } from '../services/UserResolverService.js';
import { WordExportService } from '../services/WordExportService.js';

const prisma = new PrismaClient();
const auditService = new AuditService(prisma);
const realtimeService = RealtimeService.getInstance();

interface AuthenticatedJwtPayload {
  authenticated?: boolean;
  id?: string;
  userId?: string;
  sub?: string;
  username?: string;
  role?: 'ADMIN' | 'DOCTOR';
}

function toPrismaWorkflowState(value: WorkflowState | null): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;

  // WorkflowState is the validated JSON contract; serialize it at the Prisma boundary
  // because Prisma's generated InputJsonObject type requires an index signature.
  const serialized: unknown = JSON.parse(JSON.stringify(value));
  return serialized as Prisma.InputJsonValue;
}

function toReportResponse(report: Report): ReportResponse {
  return {
    id: report.id,
    userId: report.userId,
    audioUrl: report.audioUrl,
    imageUrl: report.imageUrl || undefined,
    transcription: report.transcription,
    formalReport: report.formalReport,
    secondOpinion: report.secondOpinion || undefined,
    workflowState: ReportLifecycleService.normalizePersistedWorkflowState(report.workflowState) || undefined,
    patientName: report.patientName || undefined,
    patientId: report.patientId || undefined,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    status: report.status,
  };
}

function getActor(req: Request): {
  id: string;
  role: 'ADMIN' | 'DOCTOR';
  username?: string;
} {
  const user = req.user as AuthenticatedJwtPayload | undefined;
  const id = user?.id ?? user?.userId ?? user?.sub;

  if (!id) {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  return {
    id,
    role: user?.role ?? 'DOCTOR',
    username: user?.username,
  };
}

/**
 * POST /api/v1/reports/guardar
 * Save a manually generated/edited medical report
 */
export async function saveReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    const payload = ReportLifecycleService.validateSavePayload(req.body);
    const workflowState = ReportLifecycleService.normalizeWorkflowState(payload.workflowState);

    const audioFile = files?.audio?.[0];
    const imageFiles = [...(files?.images ?? []), ...(files?.image ?? [])];

    let audioUrl: string | undefined;
    if (audioFile) {
      audioUrl = await StorageService.saveFile(
        audioFile.buffer,
        audioFile.originalname,
        'audio'
      );
    } else {
      // In MVP, we might require audio, but if not provided we can proceed with just text
      // Let's keep it optional for pure text saves, or use a dummy URL if DB requires it
      audioUrl = 'missing-audio-url';
    }

    const imageUrls: string[] = [];
    for (const imageFile of imageFiles) {
      const imageUrl = await StorageService.saveFile(
        imageFile.buffer,
        imageFile.originalname,
        'image'
      );
      imageUrls.push(imageUrl);
    }

    const reportUserId = await UserResolverService.resolveOrCreateUserId(
      prisma,
      req.user as AuthenticatedJwtPayload | undefined
    );

    const report = await prisma.report.create({
      data: {
        userId: reportUserId,
        audioUrl: audioUrl,
        imageUrl: imageUrls[0],
        transcription: payload.transcription || 'No transcription provided',
        formalReport: payload.formalReport,
        secondOpinion: payload.secondOpinion || null,
        patientName: payload.patientName || null,
        patientId: payload.patientId || null,
        status: payload.status,
        workflowState: toPrismaWorkflowState(workflowState),
      },
    });

    await auditService.record({
      action: 'CREATE',
      actorId: reportUserId,
      entity: 'Report',
      entityId: report.id,
      metadata: { source: 'manual-save', status: payload.status },
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    const response = toReportResponse(report);

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/reports
 * Create a new medical report with AI processing
 */
export async function createReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    const { includeSecondOpinion, patientName, patientId } = req.body;

    // Validate audio file is provided
    if (!files || !files.audio || files.audio.length === 0) {
      throw new AppError('Audio file is required', 400, 'MISSING_AUDIO_FILE');
    }

    const audioFile = files.audio[0];
    const imageFile = files.images?.[0] ?? files.image?.[0];

    // Validate file size limits (Multer should catch this, but double-check)
    const audioSizeInMB = audioFile.size / (1024 * 1024);
    if (audioSizeInMB > 20) {
      throw new AppError(
        'Audio file exceeds 20MB limit',
        413,
        'AUDIO_TOO_LARGE'
      );
    }

    if (imageFile) {
      const imageSizeInMB = imageFile.size / (1024 * 1024);
      if (imageSizeInMB > 15) {
        throw new AppError(
          'Image file exceeds 15MB limit',
          413,
          'IMAGE_TOO_LARGE'
        );
      }
    }

    // Save files to storage
    const audioUrl = await StorageService.saveFile(
      audioFile.buffer,
      audioFile.originalname,
      'audio'
    );

    let imageUrl: string | undefined;
    if (imageFile) {
      imageUrl = await StorageService.saveFile(
        imageFile.buffer,
        imageFile.originalname,
        'image'
      );
    }

    const actor = getActor(req);
    realtimeService.emitProgress(actor.id, 'PROCESSING', {
      message: 'Procesando reporte clínico',
      percent: 15,
    });

    const [transcription, secondOpinion] = await Promise.all([
      // Always transcribe audio
      AiService.transcribeAudio(audioFile.buffer, audioFile.mimetype),

      // Only analyze image if provided and requested
      imageFile && includeSecondOpinion === 'true'
        ? AiService.analyzeImage(imageFile.buffer, imageFile.mimetype, {
            userId: actor.id,
            realtime: realtimeService,
            imageUrl,
          })
        : Promise.resolve(undefined),
    ]);

    // Format the transcription into a formal report
    const formalReport = await AiService.formatReport(transcription);

    const reportUserId = await UserResolverService.resolveOrCreateUserId(
      prisma,
      req.user as AuthenticatedJwtPayload | undefined
    );

    // Save report to database
    const report = await prisma.report.create({
      data: {
        userId: reportUserId,
        audioUrl,
        imageUrl,
        transcription,
        formalReport,
        secondOpinion,
        patientName: patientName || null,
        patientId: patientId || null,
      },
    });

    await auditService.record({
      action: 'AI_PROCESS',
      actorId: reportUserId,
      entity: 'Report',
      entityId: report.id,
      metadata: { includeSecondOpinion: includeSecondOpinion === 'true' },
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    realtimeService.emitProgress(actor.id, 'COMPLETED', {
      message: 'Reporte procesado',
      percent: 100,
    });

    const response = toReportResponse(report);

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/reports
 * Get paginated list of reports
 */
export async function getReports(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = getActor(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const skip = (page - 1) * limit;

    const whereClause = AuthorizationService.reportVisibilityWhere(actor);

    const reports = await prisma.report.findMany({
      where: whereClause,
      include: {
        shares: {
          where: {
            toUserId: actor.id,
            revokedAt: null,
            deletedAt: null,
          },
        },
      },
      skip,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });

    const total = await prisma.report.count({ where: whereClause });

    const response: PaginatedResponse<ReportResponse> = {
      data: reports.map(toReportResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/reports/:id
 * Get a single report by ID
 */
export async function getReportById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const report = await prisma.report.findFirst({
      where: { id, deletedAt: null },
    });

    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    const actor = getActor(req);
    const hasShare = await prisma.reportShare.findFirst({
      where: {
        reportId: report.id,
        toUserId: actor.id,
        revokedAt: null,
        deletedAt: null,
      },
    });

    if (actor.role !== 'ADMIN' && actor.id !== report.userId && !hasShare) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    if (actor.id !== report.userId) {
      await auditService.record({
        action: 'READ',
        actorId: actor.id,
        entity: 'Report',
        entityId: report.id,
        metadata: { source: 'second-opinion' },
        ip: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      });
    }

    const response = toReportResponse(report);

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/reports/:id/pdf
 * Download report as PDF
 */
export async function getReportPdf(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const report = await prisma.report.findFirst({
      where: { id, deletedAt: null },
    });

    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    const actor = getActor(req);
    const reportData = toReportResponse(report);
    const workflowState = ReportLifecycleService.normalizePersistedWorkflowState(report.workflowState);
    const pdfBuffer = await PdfService.generateReportPdf({
      ...reportData,
      doctorName: actor.username,
      modality: workflowState?.modality,
    });

    await auditService.record({
      action: 'PDF_EXPORT',
      actorId: actor.id,
      entity: 'Report',
      entityId: report.id,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Informe_Clinico_${id}.pdf"`
    );
    res.setHeader('Content-Length', pdfBuffer.length);

    res.status(200).send(pdfBuffer);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/reports/analizar-imagen
 * Creates async MONAI image-analysis job and returns 202 + job_id
 */
export async function createImageAnalysisJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    const imageFile = files?.file?.[0] || files?.image?.[0];
    if (!imageFile) {
      throw new AppError('Image file is required', 400, 'MISSING_IMAGE_FILE');
    }

    const modality =
      typeof req.body?.modality === 'string' ? req.body.modality : 'XRAY';
    const clinicalContext =
      typeof req.body?.clinicalContext === 'string'
        ? req.body.clinicalContext
        : undefined;
    const actor = getActor(req);

    const { jobId } = await ImageAnalysisJobService.createImageJob({
      imageBuffer: imageFile.buffer,
      originalName: imageFile.originalname,
      mimeType: imageFile.mimetype,
      modality,
      clinicalContext,
      requestedByUserId: actor.id,
    });

    res.status(202).json({
      job_id: jobId,
      estado: 'pendiente',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/reports/analizar-imagen/:jobId/eventos
 * SSE endpoint for image-analysis results only
 */
export async function streamImageAnalysisJobEvents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const jobId = req.params.jobId;
    if (!jobId) {
      throw new AppError('Job id is required', 400, 'MISSING_JOB_ID');
    }

    const actor = getActor(req);
    const job = await ImageAnalysisJobService.getJobOwnership(jobId);
    if (!job) {
      throw new AppError(
        'Image analysis job not found',
        404,
        'IMAGE_JOB_NOT_FOUND'
      );
    }
    if (actor.role !== 'ADMIN' && job.requestedByUserId !== actor.id) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let closed = false;
    let heartbeatTimer: NodeJS.Timeout | null = setInterval(() => {
      if (!closed) {
        res.write(': keepalive\n\n');
      }
    }, 15000);

    const sendResult = (payload: string): void => {
      if (closed) {
        return;
      }
      res.write(`event: image-analysis-result\n`);
      res.write(`data: ${payload}\n\n`);
    };

    const safeClose = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      res.end();
    };

    const cached = await ImageAnalysisJobService.getCachedResult(jobId);
    if (cached) {
      sendResult(JSON.stringify(cached));
      safeClose();
      return;
    }

    const channel = ImageAnalysisJobService.buildChannel(jobId);
    const unsubscribe = await RedisService.subscribeOnce(
      channel,
      async (payload) => {
        sendResult(payload);
        safeClose();
      }
    );

    req.on('close', () => {
      safeClose();
      void unsubscribe();
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = getActor(req);
    const { id } = req.params;

    const report = await prisma.report.findFirst({
      where: { id, deletedAt: null },
    });
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    if (actor.role !== 'ADMIN' && report.userId !== actor.id) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    const deletedAt = new Date();
    await prisma.$transaction([
      prisma.report.update({
        where: { id },
        data: { deletedAt },
      }),
      prisma.reportShare.updateMany({
        where: { reportId: id, deletedAt: null },
        data: { deletedAt },
      }),
    ]);

    await auditService.record({
      action: 'DELETE',
      actorId: actor.id,
      entity: 'Report',
      entityId: id,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function shareReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = getActor(req);
    const reportId = req.params.id ?? req.body.reportId;
    const toUserEmail = (req.body.toUserEmail ?? req.body.email) as
      | string
      | undefined;
    const reason = req.body.reason as string | undefined;

    if (!reportId || !toUserEmail) {
      throw new AppError(
        'reportId and toUserEmail are required',
        400,
        'INVALID_SHARE_REQUEST'
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { email: toUserEmail },
    });
    if (!targetUser) {
      throw new AppError(
        'Destinatario no encontrado con ese email',
        404,
        'USER_NOT_FOUND'
      );
    }
    const finalToUserId = targetUser.id;

    const report = await prisma.report.findFirst({
      where: { id: reportId, deletedAt: null },
    });
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    if (actor.role !== 'ADMIN' && report.userId !== actor.id) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    const share = await prisma.reportShare.upsert({
      where: {
        reportId_toUserId: {
          reportId,
          toUserId: finalToUserId,
        },
      },
      update: {
        reason: reason ?? null,
        revokedAt: null,
        deletedAt: null,
        fromUserId: actor.id,
      },
      create: {
        reportId,
        fromUserId: actor.id,
        toUserId: finalToUserId,
        reason: reason ?? null,
      },
    });

    await auditService.record({
      action: 'SHARE',
      actorId: actor.id,
      entity: 'ReportShare',
      entityId: share.id,
      metadata: { reportId, toUserId: finalToUserId },
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    res.status(201).json(share);
  } catch (error) {
    next(error);
  }
}

export async function getReportWord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const report = await prisma.report.findFirst({
      where: { id, deletedAt: null },
    });
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    const actor = getActor(req);
    const workflowState = ReportLifecycleService.normalizePersistedWorkflowState(report.workflowState);
    const buffer = await WordExportService.buildBuffer({
      reportId: id,
      contenido: report.formalReport,
      patientName: report.patientName,
      patientId: report.patientId,
      doctorName: actor.username,
      createdAt: report.createdAt,
      modality: workflowState?.modality,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${WordExportService.buildFilename(id)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
}

export async function generateWordPreview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = getActor(req);
    const { contenido, patientName, patientId } = req.body;
    const modality = ReportLifecycleService.validateModality(req.body?.modality);
    if (!contenido) {
      throw new AppError('Contenido is required', 400, 'MISSING_REPORT_TEXT');
    }

    const buffer = await WordExportService.buildBuffer({
      contenido: String(contenido),
      patientName: typeof patientName === 'string' ? patientName : undefined,
      patientId: typeof patientId === 'string' ? patientId : undefined,
      doctorName: actor.username,
      modality,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${WordExportService.buildFilename()}"`);
    res.setHeader('Content-Length', buffer.length);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
}

export async function resetReportDerivedState(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = getActor(req);
    const { id } = req.params;
    const report = await prisma.report.findFirst({ where: { id, deletedAt: null } });
    if (!report) throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    if (actor.role !== 'ADMIN' && report.userId !== actor.id) throw new AppError('Forbidden', 403, 'FORBIDDEN');

    const previousWorkflowState = ReportLifecycleService.normalizePersistedWorkflowState(report.workflowState);
    const workflowState = ReportLifecycleService.buildResetState(previousWorkflowState);
    const updated = await prisma.report.update({
      where: { id },
      data: {
        transcription: '',
        formalReport: '',
        secondOpinion: null,
        workflowState: toPrismaWorkflowState(workflowState),
        status: 'DRAFT',
      },
    });

    res.status(200).json(toReportResponse(updated));
  } catch (error) {
    next(error);
  }
}
