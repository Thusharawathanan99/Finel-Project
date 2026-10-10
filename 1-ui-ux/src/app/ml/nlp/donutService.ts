/** Authenticated Donut relay. The inference service and its token remain server-side. */
import {apiGet, apiPost} from '../../services/apiService';
export interface DonutMedicationResult {
  medications: {drugName: string; dosage: string; frequency: string; duration?: string; instructions?: string; route?: string; confidence: number; needsReview?: boolean; source: string}[];
  raw_text: string; confidence: number; model: string; device: string; processing_time_ms: number;
}
export interface DonutHealthStatus {status: 'ok' | 'loading' | 'offline'; model: string; device: string; gpu_available: boolean; active_inferences?: number; max_concurrent_inferences?: number;}
const env = (import.meta as ImportMeta & {env: Record<string, string | undefined>}).env;
let cachedHealthStatus: DonutHealthStatus | null = null;
let lastHealthCheck = 0;
const offline: DonutHealthStatus = {status: 'offline', model: '', device: '', gpu_available: false};
const enabled = () => env.VITE_ENABLE_CUSTOM_MODEL === 'true';
export async function checkDonutHealth(forceRefresh = false): Promise<DonutHealthStatus> {
  if (!enabled()) return offline;
  if (!forceRefresh && cachedHealthStatus && Date.now() - lastHealthCheck < 10000) return cachedHealthStatus;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const result = await apiGet<DonutHealthStatus>('/ai/donut/health', {signal: controller.signal});
    cachedHealthStatus = ['ok', 'loading', 'offline'].includes(result?.status) ? result : offline;
  } catch { cachedHealthStatus = offline; }
  finally {clearTimeout(timer); lastHealthCheck = Date.now();}
  return cachedHealthStatus;
}
export async function isDonutEnabled(): Promise<boolean> {return enabled() && (await checkDonutHealth()).status === 'ok';}
export function isDonutEnabledSync(): boolean {return enabled() && cachedHealthStatus?.status === 'ok';}
export async function analyzePrescriptionWithDonut(imageSource: File | string, timeoutMs = 120000): Promise<DonutMedicationResult> {
  let image: string;
  if (imageSource instanceof File) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/bmp'].includes(imageSource.type) || imageSource.size > 10 * 1024 * 1024) throw new Error('Use a JPEG, PNG, WebP, or BMP image up to 10MB.');
    image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image could not be read.'));
      reader.onerror = () => reject(new Error('Image could not be read.'));
      reader.onabort = () => reject(new Error('Image reading was cancelled.'));
      reader.readAsDataURL(imageSource);
    });
  } else image = imageSource;
  if (typeof image !== 'string' || !image.trim() || image.length > Math.ceil(10 * 1024 * 1024 * 4 / 3) + 128) throw new Error('Use an image up to 10MB.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(240000, timeoutMs)));
  try {
    const result = await apiPost<DonutMedicationResult & {error?: string}>('/ai/donut/predict', {image}, {signal: controller.signal});
    if (result?.error || !Array.isArray(result?.medications) || !Number.isFinite(result.confidence) || !Number.isFinite(result.processing_time_ms)) throw new Error('The Donut service returned an invalid result. Please try again.');
    if (result.medications.some(m => typeof m?.drugName !== 'string' || typeof m.dosage !== 'string' || typeof m.frequency !== 'string' || !Number.isFinite(m.confidence))) throw new Error('The Donut extraction needs another attempt.');
    return result;
  } finally { clearTimeout(timer); }
}
export async function getDonutModelInfo(): Promise<Record<string, unknown> | null> {
  const result = await checkDonutHealth(true);
  return result.status === 'offline' ? null : {...result};
}
