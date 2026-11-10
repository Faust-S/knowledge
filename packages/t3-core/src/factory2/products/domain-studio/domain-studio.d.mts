import type { Factory2StudioModel } from "./DomainStudioSurface";
export class Factory2DomainStudioError extends Error { code: string; }
export function buildFactory2StudioModel(engineeringValue: unknown): Factory2StudioModel;
