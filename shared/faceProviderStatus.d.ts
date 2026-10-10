export type FaceProviderConfigurationState = 'missing' | 'invalid' | 'available';
export type FaceProviderUiState = FaceProviderConfigurationState | 'checking' | 'unavailable';
export interface FaceProviderStatus {
  readonly provider: 'google-cloud-vision';
  readonly configurationState: FaceProviderConfigurationState;
  readonly providerVerified: false;
}
export interface FaceProviderStatusCopy {
  readonly title: string;
  readonly states: Readonly<Record<FaceProviderUiState, string>>;
}
export function getFaceProviderStatusCopy(language?: string): Readonly<FaceProviderStatusCopy>;
export function validateFaceProviderStatus(value: unknown): Readonly<FaceProviderStatus>;
