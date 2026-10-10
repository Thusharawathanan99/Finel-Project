export type FaceLanguage = 'en' | 'ta' | 'si';
export type FaceLikelihood = 'UNKNOWN' | 'VERY_UNLIKELY' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY';
export type FaceIssue = 'no_face' | 'multiple_faces' | 'low_confidence' | 'blurred' | 'dark' | 'angled' | 'small_face';
export type FaceFeeling = 'Happy' | 'Sad' | 'Angry' | 'Anxious' | 'Neutral';
export interface FaceBox { x: number; y: number; width: number; height: number; }
export interface FaceImage { width: number; height: number; }
export interface FaceReportFace {
  box: FaceBox;
  confidence: number;
  landmarkConfidence: number | null;
  pose: { roll: number | null; pan: number | null; tilt: number | null; };
  quality: { blur: FaceLikelihood; underExposure: FaceLikelihood; };
  signals: { joy: FaceLikelihood; sorrow: FaceLikelihood; anger: FaceLikelihood; surprise: FaceLikelihood; };
}
export interface FaceReport {
  version: 'face-report-v1';
  provider: 'google-cloud-vision';
  analyzedAt: string;
  image: FaceImage;
  faceCount: number;
  /** Multiple faces alone is informational and remains ready; other guidance requires retake. */
  status: 'ready' | 'retake';
  faces: FaceReportFace[];
  issues: FaceIssue[];
}
export interface FaceCopy {
  title: string; subtitle: string; language: string; camera: string; cameraHint: string; capture: string; upload: string;
  analyze: string; analyzing: string; retake: string; close: string; cancel: string; back: string; preview: string;
  report: string; download: string; share: string; consent: string; privacyNotice: string; limitations: string;
  confidenceHelp: string; signalsHelp: string; ready: string; retakeNeeded: string; faces: string; face: string;
  confidence: string; landmarkConfidence: string; qualityTitle: string; signalsTitle: string; poseTitle: string; issuesTitle: string; likelihoodTitle: string;
  provider: string; analyzedAt: string; imageSize: string; capturedAt: string; pixels: string; degrees: string;
  box: string; left: string; top: string; width: string; height: string; unknown: string; none: string; noFaces: string;
  unavailable: string; cameraPermission: string; cameraDenied: string; requestPermission: string; cameraUnavailable: string;
  loading: string; noImage: string; fileInvalid: string; imageTooLarge: string;
  selfReportTitle: string; selfReportHelp: string; feeling: string; score: string; scoreLow: string; scoreHigh: string;
  scoreHint: string; note: string; notePlaceholder: string; medicine: string; noMedicine: string; save: string;
  saving: string; saved: string; saveHelp: string; signIn: string;
  feelings: Readonly<Record<FaceFeeling, string>>;
  quality: Readonly<Record<'blur' | 'underExposure', string>>;
  pose: Readonly<Record<'roll' | 'pan' | 'tilt', string>>;
  signals: Readonly<Record<'joy' | 'sorrow' | 'anger' | 'surprise', string>>;
  likelihood: Readonly<Record<FaceLikelihood, string>>;
  issues: Readonly<Record<FaceIssue, string>>;
  errors: Readonly<Record<'FACE_NOT_CONFIGURED' | 'FACE_UNAVAILABLE' | 'INVALID_IMAGE' | 'INVALID_REPORT' | 'IMAGE_TOO_LARGE' |
    'camera' | 'save' | 'session' | 'share' | 'timeout' | 'rateLimit' | 'permission' | 'network' | 'score' |
    'unavailable' | 'invalidReport' | 'tooLarge' | 'invalidImage' | 'cameraError' | 'authError' | 'saveError' | 'shareError', string>>;
  faceCount: string; reportReady: string; reportRetake: string; qualityLabel: string; poseLabel: string;
  signalsLabel: string; issuesLabel: string; likelihoodLabel: string; imageDimensions: string; confidenceNotice: string;
  blur: string; underExposure: string; processing: string; cameraError: string; uploadError: string;
  invalidReport: string; analysisUnavailable: string; requestTimedOut: string; rateLimited: string;
  permissionDenied: string; networkError: string; reportShareFailed: string;
  selfReport: string; selfReportNotice: string; feelingLabel: string; scoreLabel: string; noteLabel: string;
  medicineLabel: string; medicineOptional: string; saveFailed: string; consentNotice: string;
}
export const FACE_LANGUAGES: ReadonlyArray<Readonly<{ code: FaceLanguage; label: string }>>;
export const FACE_LIKELIHOODS: ReadonlyArray<FaceLikelihood>;
export const FACE_ISSUES: ReadonlyArray<FaceIssue>;
/** Derives factual guidance; multiple_faces is informational, all other issues require retake. */
export function deriveFaceReportIssues(faces: FaceReportFace[], image: FaceImage): FaceIssue[];
/** Throws TypeError for malformed or inconsistent data; returns a fresh whitelist. */
export function validateFaceReport(input: unknown): FaceReport;
/** Unsupported languages fall back to English. Copy is deeply immutable. */
export function getFaceCopy(language?: string): Readonly<FaceCopy>;
/** Validates first; only canonical photo facts and fixed translations enter text. */
export function buildFaceReportText(input: unknown, language?: string): string;
