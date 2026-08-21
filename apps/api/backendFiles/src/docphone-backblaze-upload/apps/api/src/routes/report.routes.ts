/**
 * Report routes
 * Handles all report-related endpoints
 */

import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { uploadFiles, compressImage } from '../middlewares/uploadMiddleware.js';
import { AiService } from '../services/AiService.js';
import { AppError } from '../middlewares/errorHandler.js';
import {
  createImageAnalysisJob,
  createReport,
  deleteReport,
  generateWordPreview,
  getReports,
  getReportById,
  getReportPdf,
  getReportWord,
  resetReportDerivedState,
  saveReport,
  shareReport,
  streamImageAnalysisJobEvents,
} from '../controllers/report.controller.js';
import { ReportLifecycleService } from '../services/ReportLifecycleService.js';

const router = Router();
const uploadPdfImages = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'images', maxCount: 10 },
  { name: 'image', maxCount: 10 },
]);

// All report routes require authentication
router.use(authMiddleware);

// --- INTERMEDIATE ENDPOINTS (For 4-step UI) ---

router.post('/transcribir', uploadFiles, async (req, res, next) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const audioFile = files?.file?.[0] || files?.audio?.[0];
    if (!audioFile) throw new AppError('Audio file is required', 400);

    const transcription = await AiService.transcribeAudio(audioFile.buffer, audioFile.mimetype);
    // Return direct result simulating a completed job for legacy UI compatibility
    res.json({ job_id: 'instant', estado: 'terminado', resultado: transcription, texto: transcription });
  } catch (error) {
    next(error);
  }
});

router.get('/transcribir', (req, res) => {
  // Mock polling endpoint - always returns finished since we do it instantly
  res.json({ estado: 'terminado' });
});

router.post('/formalizar', async (req, res, next) => {
  try {
    const { texto, modality } = req.body;
    if (!texto) throw new AppError('Text is required', 400);
    
    const formalReport = await AiService.formatReport(texto, typeof modality === 'string' ? modality : undefined);
    res.json({ textoFormal: formalReport });
  } catch (error) {
    next(error);
  }
});

router.post('/generar-pdf', uploadPdfImages, async (req, res, next) => {
  try {
    const { contenido, patientName, patientId, modality } = req.body;
    if (!contenido) throw new AppError('Contenido is required', 400);
    const normalizedModality = ReportLifecycleService.validateModality(modality);

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const imageFiles = [
      ...(files?.images ?? []),
      ...(files?.image ?? []),
    ];
    const imageBuffers = imageFiles.map((file) => file.buffer);

    const { PdfService } = await import('../services/PdfService.js');
    
    const mockReport = {
      id: 'preview',
      formalReport: contenido,
      patientName: patientName || undefined,
      patientId: patientId || undefined,
      workflowState: { step: 0, modality: normalizedModality },
      imageBuffers,
      createdAt: new Date(),
    };
    
    const pdfBuffer = await PdfService.generateReportPdf(mockReport);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="preview.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);

    res.status(200).send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

router.post('/generar-word', generateWordPreview);

router.post('/analizar-imagen', uploadFiles, compressImage, createImageAnalysisJob);
router.get('/analizar-imagen/:jobId/eventos', streamImageAnalysisJobEvents);

// --- MONOLITHIC ENDPOINTS ---

router.post('/', uploadFiles, compressImage, createReport);
router.post('/guardar', uploadFiles, compressImage, saveReport);
router.get('/', getReports);
router.get('/:id', getReportById);
router.get('/:id/pdf', getReportPdf);
router.get('/:id/word', getReportWord);
router.post('/:id/reset', resetReportDerivedState);
router.delete('/:id', deleteReport);
router.post('/share', shareReport);
router.post('/:id/share', shareReport);

export default router;
