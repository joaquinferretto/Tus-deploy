import type { ConfigContext, ExpoConfig } from 'expo/config';
import { z } from 'zod';

const PROFILE_VALUES = ['dev', 'staging', 'prod'] as const;
const AppProfileSchema = z.enum(PROFILE_VALUES);
type AppProfile = z.infer<typeof AppProfileSchema>;

const BUNDLE_IDENTIFIERS: Record<AppProfile, string> = {
  prod: 'com.alqui',
  staging: 'com.alqui.staging',
  dev: 'com.alqui.dev',
};

const PROFILE_DEFAULTS: Record<
  AppProfile,
  {
    displayName: string;
    scheme: string;
    apiUrl: string;
    oauthIssuer: string;
    oauthClientId: string;
    sentryEnvironment: string;
    requireTls: boolean;
    enableMockAuth: boolean;
  }
> = {
  dev: {
    displayName: 'Alqui Dev',
    scheme: 'alqui-dev',
    apiUrl: 'http://localhost:3000',
    oauthIssuer: 'https://auth-dev.alqui.example.com',
    oauthClientId: 'alqui-mobile-dev',
    sentryEnvironment: 'development',
    requireTls: false,
    enableMockAuth: true,
  },
  staging: {
    displayName: 'Alqui Staging',
    scheme: 'alqui-staging',
    apiUrl: 'https://api-staging.alqui.example.com',
    oauthIssuer: 'https://auth-staging.alqui.example.com',
    oauthClientId: 'alqui-mobile-staging',
    sentryEnvironment: 'staging',
    requireTls: true,
    enableMockAuth: false,
  },
  prod: {
    displayName: 'Alqui',
    scheme: 'alqui',
    apiUrl: '',
    oauthIssuer: '',
    oauthClientId: '',
    sentryEnvironment: 'production',
    requireTls: true,
    enableMockAuth: false,
  },
};

const RuntimeConfigSchema = z
  .object({
    profile: AppProfileSchema,
    displayName: z.string().min(1),
    scheme: z.string().min(1),
    bundleIdentifier: z.string().min(1),
    apiUrl: z.string().url(),
    oauthIssuer: z.string().url(),
    oauthClientId: z.string().min(1),
    sentryDsn: z.string().url().or(z.literal('')),
    sentryEnvironment: z.string().min(1),
    requireTls: z.boolean(),
    featureFlags: z.object({
      offlineCache: z.boolean(),
      sentry: z.boolean(),
      mockAuth: z.boolean(),
      strictTls: z.boolean(),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.requireTls && !value.apiUrl.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiUrl'],
        message: `${value.profile} requires an HTTPS API URL`,
      });
    }

    if (value.requireTls && !value.oauthIssuer.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['oauthIssuer'],
        message: `${value.profile} requires an HTTPS OAuth issuer`,
      });
    }

    if (value.profile === 'prod' && value.sentryDsn.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sentryDsn'],
        message: 'prod requires SENTRY_DSN or EXPO_PUBLIC_SENTRY_DSN',
      });
    }
  });

type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

const env = {
  APP_PROFILE: process.env.APP_PROFILE,
  EXPO_PUBLIC_APP_PROFILE: process.env.EXPO_PUBLIC_APP_PROFILE,
  EXPO_PUBLIC_REQUIRE_TLS: process.env.EXPO_PUBLIC_REQUIRE_TLS,
  SENTRY_DSN: process.env.SENTRY_DSN,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_OAUTH_ISSUER: process.env.EXPO_PUBLIC_OAUTH_ISSUER,
  EXPO_PUBLIC_OAUTH_CLIENT_ID: process.env.EXPO_PUBLIC_OAUTH_CLIENT_ID,
  SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
  EXPO_PUBLIC_OFFLINE_CACHE: process.env.EXPO_PUBLIC_OFFLINE_CACHE,
  EXPO_PUBLIC_ENABLE_MOCK_AUTH: process.env.EXPO_PUBLIC_ENABLE_MOCK_AUTH,
  EAS_PROJECT_ID: process.env.EAS_PROJECT_ID,
} as const;

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function readProfile(): AppProfile {
  return AppProfileSchema.parse(env.APP_PROFILE ?? env.EXPO_PUBLIC_APP_PROFILE ?? 'dev');
}

function envOrDefault(profile: AppProfile, raw: string | undefined, fallback: string): string {
  if (raw !== undefined && raw.length > 0) return raw;
  return profile === 'prod' ? '' : fallback;
}

function resolveRuntimeConfig(): RuntimeConfig {
  const profile = readProfile();
  const defaults = PROFILE_DEFAULTS[profile];
  const requireTls = parseBoolean(env.EXPO_PUBLIC_REQUIRE_TLS, defaults.requireTls);
  const sentryDsn = env.SENTRY_DSN ?? env.EXPO_PUBLIC_SENTRY_DSN ?? '';

  return RuntimeConfigSchema.parse({
    profile,
    displayName: defaults.displayName,
    scheme: defaults.scheme,
    bundleIdentifier: BUNDLE_IDENTIFIERS[profile],
    apiUrl: envOrDefault(profile, env.EXPO_PUBLIC_API_URL, defaults.apiUrl),
    oauthIssuer: envOrDefault(profile, env.EXPO_PUBLIC_OAUTH_ISSUER, defaults.oauthIssuer),
    oauthClientId: envOrDefault(profile, env.EXPO_PUBLIC_OAUTH_CLIENT_ID, defaults.oauthClientId),
    sentryDsn,
    sentryEnvironment: env.SENTRY_ENVIRONMENT ?? defaults.sentryEnvironment,
    requireTls,
    featureFlags: {
      offlineCache: parseBoolean(env.EXPO_PUBLIC_OFFLINE_CACHE, true),
      sentry: sentryDsn.length > 0,
      mockAuth: parseBoolean(env.EXPO_PUBLIC_ENABLE_MOCK_AUTH, defaults.enableMockAuth),
      strictTls: requireTls,
    },
  });
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const runtime = resolveRuntimeConfig();

  return {
    ...config,
    name: runtime.displayName,
    slug: 'alqui',
    scheme: runtime.scheme,
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      ...config.ios,
      bundleIdentifier: runtime.bundleIdentifier,
      supportsTablet: true,
      config: {
        ...config.ios?.config,
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: !runtime.requireTls,
        },
      },
    },
    android: {
      ...config.android,
      package: runtime.bundleIdentifier,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0B1220',
      },
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#0B1220',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      ...config.extra,
      runtime,
      eas: {
        projectId: env.EAS_PROJECT_ID,
      },
    },
  };
};
