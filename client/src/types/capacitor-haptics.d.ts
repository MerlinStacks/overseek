/**
 * Ambient type declarations for @capacitor/haptics.
 *
 * Why: This package is only installed in native Capacitor builds.
 * Web/Docker builds keep it as an external (see vite.config.ts rollupOptions)
 * and load it via a dynamic import with a try/catch fallback.
 * This stub satisfies the TypeScript compiler without pulling in the real package.
 */

declare module '@capacitor/haptics' {
    export enum ImpactStyle {
        Heavy = 'HEAVY',
        Medium = 'MEDIUM',
        Light = 'LIGHT',
    }

    export enum NotificationType {
        Success = 'SUCCESS',
        Warning = 'WARNING',
        Error = 'ERROR',
    }

    export interface ImpactOptions {
        style: ImpactStyle;
    }

    export interface NotificationOptions {
        type: NotificationType;
    }

    export interface VibrateOptions {
        duration: number;
    }

    export interface HapticsPlugin {
        impact(options?: ImpactOptions): Promise<void>;
        notification(options?: NotificationOptions): Promise<void>;
        vibrate(options?: VibrateOptions): Promise<void>;
        selectionStart(): Promise<void>;
        selectionChanged(): Promise<void>;
        selectionEnd(): Promise<void>;
    }

    export const Haptics: HapticsPlugin;
}
