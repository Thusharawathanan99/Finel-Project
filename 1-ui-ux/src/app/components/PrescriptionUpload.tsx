import { useState, useEffect, useRef } from 'react';
import {
  Upload, Camera, X, FileText, Sparkles, Loader, CheckCircle, AlertTriangle,
  Pill, Cpu, Brain, Zap, Calendar, User, UserCheck, Clock, ShieldAlert, Edit2, Plus, Trash2
} from 'lucide-react';
import { OCREngine } from '../models/OCREngine';
import { NLPEngine, NLPResult } from '../models/NLPEngine';
import { Medication } from '../models/Medication';
import { checkDonutHealth, DonutHealthStatus, analyzePrescriptionWithDonut } from '../ml/nlp/donutService';
import { modelAccuracyTracker } from '../ml/ensemble/ModelAccuracyTracker';
import { cleanPrescriptionField } from '../../../../4-system-engine/api/routes/prescriptionSafety.js';

interface PrescriptionUploadProps {
  residentName: string;
  residentId?: string;
  onUpload: (
    doctorName: string,
    imageFile: File | null,
    medications?: Medication[],
    patientName?: string,
    dateIssued?: string,
    rawText?: string
  ) => Promise<void> | void;
  onClose: () => void;
}

type ProcessingStep = 'idle' | 'preprocessing' | 'ocr' | 'ensemble' | 'nlp' | 'verification' | 'complete' | 'error';

export function PrescriptionUpload({ residentName, residentId, onUpload, onClose }: PrescriptionUploadProps) {
  const [patientName, setPatientName] = useState(residentName);
  const [doctorName, setDoctorName] = useState('');
  const [prescriptionDate, setPrescriptionDate] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploadMethod, setUploadMethod] = useState<'file' | 'camera'>('file');
  const [step, setStep] = useState<ProcessingStep>('idle');
  const [nlpResult, setNlpResult] = useState<NLPResult | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [extractedText, setExtractedText] = useState('');
  const [error, setError] = useState('');
  const [donutStatus, setDonutStatus] = useState<DonutHealthStatus | null>(null);

  // Camera stream state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageSelectionRef = useRef(0);
  const savedRef = useRef(false);
  const hasDraft = Boolean(preview || doctorName.trim() || prescriptionDate || medications.length || extractedText);

  const attemptClose = () => {
    if (processing) return;
    if (hasDraft && !savedRef.current && !window.confirm('Discard this prescription draft? Your reviewed details have not been saved.')) return;
    onClose();
  };

  // Check Donut backend on mount
  useEffect(() => {
    checkDonutHealth().then(setDonutStatus);
    return () => {
      imageSelectionRef.current++;
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!hasDraft || savedRef.current) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasDraft]);

  const startCamera = async () => {
    setCameraError('');
    setIsCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.warn('Webcam stream failed:', err);
      setCameraError('Could not access live camera. Please use file upload or select camera from file picker.');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (processing || !videoRef.current) return;
    const selection = ++imageSelectionRef.current;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    canvas.toBlob((blob) => {
      if (blob && selection === imageSelectionRef.current) {
        const file = new File([blob], `prescription-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setSelectedFile(file);
      }
    }, 'image/jpeg', 0.92);

    setPreview(dataUrl);
    setMedications([]);
    setDoctorName('');
    setPrescriptionDate('');
    setPatientName(residentName);
    setNlpResult(null);
    setExtractedText('');
    setError('');
    setStep('idle');
    stopCamera();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (processing) return;
    const file = e.target.files?.[0];
    if (file) {
      const selection = ++imageSelectionRef.current;
      setSelectedFile(file);
      setPreview(null);
      setDoctorName('');
      setPrescriptionDate('');
      setPatientName(residentName);
      setNlpResult(null);
      setMedications([]);
      setExtractedText('');
      setError('');
      setStep('idle');
      const reader = new FileReader();
      reader.onloadend = () => {
        if (selection === imageSelectionRef.current) setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (processing) return;
    if (!preview) {
      setError('Please select or capture a prescription image first.');
      return;
    }

    setProcessing(true);
    setError('');
    setNlpResult(null);
    setMedications([]);
    const selection = imageSelectionRef.current;

    try {
      const freshDonutStatus = await checkDonutHealth(true);
      setDonutStatus(freshDonutStatus);
      const donutAvailable = freshDonutStatus.status === 'ok';

      // Step 1: Preprocessing
      setStep('preprocessing');
      await new Promise(r => setTimeout(r, 200));

      let donutPromise: Promise<any> | undefined;
      if (donutAvailable && selectedFile) {
        donutPromise = analyzePrescriptionWithDonut(selectedFile).catch(err => {
          console.warn('[Upload] Donut execution non-fatal error:', err);
          return null;
        });
      }

      // Step 2: OCR Extraction
      setStep('ocr');
      const ocrEngine = new OCREngine('2.5.1');
      const imageSource = selectedFile || preview || '';
      const ocrResult = await ocrEngine.extractText(imageSource);
      if (ocrResult.text) {
        setExtractedText(ocrResult.text);
      }

      // Step 3: NLP + Ensemble Parsing
      setStep(donutAvailable ? 'ensemble' : 'nlp');
      const nlpEngine = new NLPEngine('3.1.0');
      const result = await nlpEngine.parseTextToMedication(
        ocrResult.text,
        preview || undefined,
        selectedFile || preview || undefined,
        donutPromise
      );
      if (selection !== imageSelectionRef.current) return;

      // Step 4: Verification step
      if (result.geminiVerified) {
        setStep('verification');
        await new Promise(r => setTimeout(r, 300));
      }

      // Auto-populate header fields if extracted
      if (result.doctorName && result.doctorName !== 'Needs Review') {
        setDoctorName(result.doctorName);
      }
      if (result.patientName && result.patientName !== 'Needs Review') {
        setPatientName(result.patientName);
      }
      if (result.date && result.date !== 'Needs Review') {
        setPrescriptionDate(result.date);
      }

      // Populate raw text if available from AI
      if (result.rawText) {
        setExtractedText(result.rawText);
      }

      setNlpResult(result);
      setMedications(result.medications);
      setStep('complete');

    } catch (err) {
      console.error('Prescription processing error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Processing failed.';
      if (errorMsg.includes('404') || errorMsg.includes('Generative Language')) {
        setError('Gemini API not enabled. Enable "Generative Language API" in Google Cloud Console.');
      } else if (errorMsg.includes('429') || errorMsg.includes('quota')) {
        setError('API rate limit reached. Please wait a minute and retry.');
      } else if (errorMsg.toLowerCase().includes('timeout') || errorMsg.includes('503')) {
        setError('AI service is temporarily overloaded. Please retry.');
      } else {
        setError(errorMsg);
      }
      setStep('error');
    } finally {
      setProcessing(false);
    }
  };

  const handleMedicationChange = (index: number, field: keyof Medication, value: any) => {
    setMedications(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // Editing a field does not prove that all conflicting readings were checked.
      next[index].needsReview = true;
      next[index].verifiedByUser = false;
      return next;
    });
  };

  const handleAddMedication = () => {
    const newMed = new Medication(
      'New Medication',
      'Needs Review',
      'Needs Review',
      undefined,
      'As directed',
      'Follow doctor guidance',
      0.7,
      true
    );
    setMedications(prev => [...prev, newMed]);
  };

  const handleRemoveMedication = (index: number) => {
    setMedications(prev => prev.filter((_, i) => i !== index));
  };

  const hasCompleteRegimen = (med: Medication) => Boolean(
    cleanPrescriptionField(med.drugName) && med.drugName.trim() !== 'New Medication' &&
    cleanPrescriptionField(med.dosage) && cleanPrescriptionField(med.frequency)
  );

  const handleVerifyMedication = (index: number) => {
    if (!hasCompleteRegimen(medications[index])) {
      setError('Enter the medicine name, dose and schedule from the prescription before verifying it.');
      return;
    }
    setMedications(prev => prev.map((med, i) => i === index ? { ...med, needsReview: false, verifiedByUser: true } : med));
    setError('');
  };

  const handleConfirm = async () => {
    if (!doctorName.trim() || doctorName === 'Needs Review') {
      setError('Please provide a valid Doctor Name before confirming.');
      return;
    }
    if (!medications.length || medications.some(med => !hasCompleteRegimen(med) || med.needsReview || (med.conflictingFields?.length && !med.verifiedByUser))) {
      setError('Check every medicine against the prescription image and verify each row marked for review before saving.');
      return;
    }
    const date = new Date(`${prescriptionDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(prescriptionDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== prescriptionDate) {
      setError('Enter the issue date shown on the prescription in YYYY-MM-DD format.');
      return;
    }

    setProcessing(true);
    setError('');
    try {
      await onUpload(
        doctorName,
        selectedFile,
        medications.map(med => ({ ...med, verifiedByUser: true })),
        patientName,
        prescriptionDate,
        extractedText
      );
      if (nlpResult?.predictionId) {
        modelAccuracyTracker.recordCorrection(nlpResult.predictionId, medications);
      }
      savedRef.current = true;
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save prescription.';
      setError(msg);
      setStep('error');
    } finally {
      setProcessing(false);
    }
  };

  const getStepStatus = (targetStep: ProcessingStep) => {
    const order: ProcessingStep[] = ['preprocessing', 'ocr', 'ensemble', 'nlp', 'verification', 'complete'];
    const currentIdx = order.indexOf(step);
    const targetIdx = order.indexOf(targetStep);

    if (step === 'error') return 'error';
    if (currentIdx > targetIdx) return 'done';
    if (currentIdx === targetIdx) return 'active';
    return 'pending';
  };

  const isEnsembleMode = donutStatus?.status === 'ok';

  const processingSteps = [
    { key: 'preprocessing' as ProcessingStep, label: 'Preprocessing Image', icon: '🖼️' },
    { key: 'ocr' as ProcessingStep, label: 'OCR Text Extraction', icon: '🔍' },
    ...(isEnsembleMode
      ? [{ key: 'ensemble' as ProcessingStep, label: 'Ensemble AI (Donut + Regex + Gemini)', icon: '🧠' }]
      : [{ key: 'nlp' as ProcessingStep, label: 'NLP Medication Parsing', icon: '💊' }]
    ),
    { key: 'verification' as ProcessingStep, label: 'Cross-check Readings', icon: '✅' },
  ];

  const progressOrder: ProcessingStep[] = processingSteps.map(s => s.key);
  const currentProgressIndex = progressOrder.indexOf(step);
  const doneSteps = processingSteps.filter(s => getStepStatus(s.key) === 'done').length;
  const progressPercent = step === 'complete'
    ? 100
    : step === 'error'
      ? Math.round((doneSteps / processingSteps.length) * 100)
      : currentProgressIndex >= 0
        ? Math.round(((currentProgressIndex + 1) / processingSteps.length) * 100)
        : 0;

  return (
    <div className="care-modal-overlay fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* Modal Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 font-bold">
              Rx
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">AI Prescription Reader</h3>
              <p className="text-xs text-gray-500">Patient: <span className="font-semibold text-gray-700">{patientName}</span></p>
            </div>
          </div>
          <button
            onClick={attemptClose}
            disabled={processing}
            aria-label="Close prescription upload"
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500 hover:text-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Upload Method Tabs */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
              Input Method
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setUploadMethod('file');
                  stopCamera();
                }}
                disabled={processing}
                className={`p-3.5 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                  uploadMethod === 'file'
                    ? 'border-teal-500 bg-teal-50/50 text-teal-800 font-semibold shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
              >
                <Upload className="w-5 h-5" />
                <span className="text-sm">Upload Image</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setUploadMethod('camera');
                  startCamera();
                }}
                disabled={processing}
                className={`p-3.5 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                  uploadMethod === 'camera'
                    ? 'border-teal-500 bg-teal-50/50 text-teal-800 font-semibold shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
              >
                <Camera className="w-5 h-5" />
                <span className="text-sm">Capture with Camera</span>
              </button>
            </div>
          </div>

          {/* Live Camera Viewfinder (if active) */}
          {isCameraActive && (
            <div className="border-2 border-teal-500 rounded-2xl p-4 bg-gray-900 text-center space-y-4">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-h-72 mx-auto">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                <div className="absolute inset-0 border-2 border-dashed border-teal-300/60 pointer-events-none rounded-xl m-4" />
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={capturePhoto}
                  disabled={processing}
                  className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold shadow-lg flex items-center gap-2"
                >
                  <Camera className="w-5 h-5" />
                  Snap Photo
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-xl text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {cameraError && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              {cameraError}
            </div>
          )}

          {/* File Upload / Preview Area */}
          {!isCameraActive && (
            <div className="border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center bg-gray-50/70 hover:bg-gray-100/70 transition-colors">
              {preview ? (
                <div className="space-y-3">
                  <div className="relative inline-block">
                    <img src={preview} alt="Prescription preview" className="max-h-56 mx-auto rounded-xl shadow-md border border-gray-200" />
                    {!processing && step !== 'complete' && (
                      <button
                        type="button"
                        onClick={() => {
                          imageSelectionRef.current++;
                          setSelectedFile(null);
                          setPreview(null);
                          setNlpResult(null);
                          setMedications([]);
                          setExtractedText('');
                          setStep('idle');
                        }}
                        className="absolute -top-2 -right-2 p-1.5 bg-red-600 text-white rounded-full hover:bg-red-700 shadow-md"
                        title="Remove image"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 font-medium">{selectedFile?.name || 'Captured prescription photo'}</p>
                </div>
              ) : (
                <label className="cursor-pointer block py-4">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    disabled={processing}
                    className="hidden"
                    capture={uploadMethod === 'camera' ? 'environment' : undefined}
                  />
                  {uploadMethod === 'file' ? (
                    <FileText className="w-12 h-12 mx-auto mb-3 text-teal-600/70" />
                  ) : (
                    <Camera className="w-12 h-12 mx-auto mb-3 text-teal-600/70" />
                  )}
                  <p className="text-gray-800 font-semibold mb-1">
                    {uploadMethod === 'file' ? 'Choose prescription photo' : 'Open camera or select photo'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Supports JPG, PNG, WEBP (Clear, well-lit photos give best accuracy)
                  </p>
                </label>
              )}
            </div>
          )}

          {/* System Mode Badge */}
          {step === 'idle' && (
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs ${
              isEnsembleMode
                ? 'bg-purple-50 text-purple-800 border border-purple-200'
                : 'bg-teal-50 text-teal-800 border border-teal-200'
            }`}>
              {isEnsembleMode ? (
                <>
                  <Zap className="w-4 h-4 text-purple-600" />
                  <span className="font-bold">Multi-Model Ensemble Active:</span>
                  <span>Donut OCR ({donutStatus?.device}) + Local RxNorm + Gemini Cloud AI</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-teal-600" />
                  <span className="font-bold">AI Reader Active:</span>
                  <span>Regex Parser + Google Gemini Clinical Vision</span>
                </>
              )}
            </div>
          )}

          {/* Processing Progress */}
          {step !== 'idle' && (
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
                <span>{isEnsembleMode ? 'Ensemble Pipeline Running' : 'Prescription Pipeline'}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    step === 'error' ? 'bg-red-500' : 'bg-gradient-to-r from-teal-500 to-teal-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                {processingSteps.map(({ key, label }) => {
                  const status = getStepStatus(key);
                  return (
                    <div key={key} className={`p-2 rounded-lg text-xs flex items-center gap-2 ${
                      status === 'done' ? 'bg-green-50 text-green-700 font-medium' :
                      status === 'active' ? 'bg-teal-50 text-teal-700 font-bold border border-teal-200' :
                      status === 'error' ? 'bg-red-50 text-red-700' :
                      'bg-gray-100/60 text-gray-400'
                    }`}>
                      {status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />}
                      {status === 'active' && <Loader className="w-3.5 h-3.5 text-teal-600 animate-spin flex-shrink-0" />}
                      {status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-gray-300 flex-shrink-0" />}
                      {status === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-800">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold">Notice</p>
                <p className="text-xs text-red-700 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Extracted Header Metadata (Patient, Doctor, Date) */}
          {step === 'complete' && (
            <div className="bg-gradient-to-r from-teal-50/50 to-teal-50/50 border border-teal-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-teal-600" />
                  Prescription Metadata
                </h4>
                <span className="text-xs bg-teal-100 text-teal-800 px-2.5 py-0.5 rounded-full font-semibold">
                  Check against image
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Patient Name */}
                <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 flex items-center gap-1 font-medium">
                      <User className="w-3 h-3" /> Patient Name
                    </span>
                    {patientName === 'Needs Review' && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-semibold">
                        Needs Review
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="w-full text-sm font-bold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-teal-500 focus:outline-none py-0.5"
                    placeholder="Patient Name"
                  />
                </div>

                {/* Doctor Name */}
                <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 flex items-center gap-1 font-medium">
                      <UserCheck className="w-3 h-3" /> Doctor Name
                    </span>
                    {(!doctorName || doctorName === 'Needs Review') && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-semibold">
                        Needs Review
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    className="w-full text-sm font-bold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-teal-500 focus:outline-none py-0.5"
                    placeholder="e.g. Dr. John Smith"
                  />
                </div>

                {/* Date */}
                <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 flex items-center gap-1 font-medium">
                      <Calendar className="w-3 h-3" /> Date Issued
                    </span>
                    {prescriptionDate === 'Needs Review' && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-semibold">
                        Needs Review
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={prescriptionDate}
                    onChange={(e) => setPrescriptionDate(e.target.value)}
                    className="w-full text-sm font-bold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-teal-500 focus:outline-none py-0.5"
                    placeholder="YYYY-MM-DD"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Structured Medications List */}
          {step === 'complete' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Pill className="w-4 h-4 text-teal-600" />
                  Prescribed Medications ({medications.length})
                </h4>
                <button
                  type="button"
                  onClick={handleAddMedication}
                  className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1 bg-teal-50 px-2.5 py-1 rounded-lg border border-teal-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Medication
                </button>
              </div>

              {medications.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
                  <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
                  <h5 className="font-bold text-amber-900">No Medications Recognized</h5>
                  <p className="text-xs text-amber-700 max-w-md mx-auto">
                    The AI examined the image but did not detect standard medication rows with confidence. You can add medicines manually using the button above or retry with a clearer photo.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {medications.map((med, idx) => {
                    const isReviewNeeded = med.needsReview || !hasCompleteRegimen(med) || Boolean(med.conflictingFields?.length && !med.verifiedByUser);
                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-xl border transition-all ${
                          isReviewNeeded
                            ? 'bg-amber-50/40 border-amber-300 shadow-sm'
                            : 'bg-white border-gray-200 shadow-sm hover:border-teal-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1">
                            <input
                              type="text"
                              value={med.drugName}
                              onChange={(e) => handleMedicationChange(idx, 'drugName', e.target.value)}
                              className="text-base font-bold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-teal-500 focus:outline-none w-full"
                              placeholder="Medication Name"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            {isReviewNeeded ? (
                              <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-600" /> Needs Review
                              </span>
                            ) : (
                              <span className="text-[11px] bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                <CheckCircle className="w-3 h-3 text-green-600" /> {med.verifiedByUser ? 'Checked against image' : 'Extraction complete'}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveMedication(idx)}
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                              title="Delete row"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* 4 Details Grid: Dosage, Frequency, Duration, Instructions */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-gray-100 text-xs">
                          <div>
                            <span className="text-gray-500 font-semibold block mb-0.5">Dosage</span>
                            <input
                              type="text"
                              value={med.dosage}
                              onChange={(e) => handleMedicationChange(idx, 'dosage', e.target.value)}
                              className={`w-full px-2 py-1 rounded border font-medium ${
                                med.dosage === 'Needs Review'
                                  ? 'border-amber-300 bg-amber-50 text-amber-900 font-bold'
                                  : 'border-gray-200 text-gray-800'
                              }`}
                              placeholder="e.g. 500mg"
                            />
                          </div>

                          <div>
                            <span className="text-gray-500 font-semibold block mb-0.5">Frequency</span>
                            <input
                              type="text"
                              value={med.frequency}
                              onChange={(e) => handleMedicationChange(idx, 'frequency', e.target.value)}
                              className={`w-full px-2 py-1 rounded border font-medium ${
                                med.frequency === 'Needs Review'
                                  ? 'border-amber-300 bg-amber-50 text-amber-900 font-bold'
                                  : 'border-gray-200 text-gray-800'
                              }`}
                              placeholder="e.g. Twice daily"
                            />
                          </div>

                          <div>
                            <span className="text-gray-500 font-semibold block mb-0.5">Duration</span>
                            <input
                              type="text"
                              value={med.duration || ''}
                              onChange={(e) => handleMedicationChange(idx, 'duration', e.target.value)}
                              className="w-full px-2 py-1 rounded border border-gray-200 text-gray-800 font-medium"
                              placeholder="e.g. 7 days"
                            />
                          </div>

                          <div>
                            <span className="text-gray-500 font-semibold block mb-0.5">Instructions</span>
                            <input
                              type="text"
                              value={med.instructions || ''}
                              onChange={(e) => handleMedicationChange(idx, 'instructions', e.target.value)}
                              className="w-full px-2 py-1 rounded border border-gray-200 text-gray-800 font-medium"
                              placeholder="e.g. After meals"
                            />
                          </div>
                        </div>
                        {(med.reviewReasons?.length || med.conflictingFields?.length) ? (
                          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                            {med.reviewReasons?.map((reason, reasonIndex) => <p key={reasonIndex}>{reason}</p>)}
                            {med.sourceDetails && (
                              <details className="mt-2">
                                <summary className="cursor-pointer font-semibold">Compare extracted readings</summary>
                                {Object.entries(med.sourceDetails).map(([source, details]) => details?.candidates.map((candidate, evidenceIndex) => (
                                  <p key={`${source}-${evidenceIndex}`} className="mt-1">
                                    <strong>{source}:</strong> {[candidate.dosage, candidate.frequency, candidate.duration, candidate.instructions].filter(Boolean).join(' · ')}
                                  </p>
                                )))}
                              </details>
                            )}
                          </div>
                        ) : null}
                        {isReviewNeeded && (
                          <button type="button" onClick={() => handleVerifyMedication(idx)} disabled={!hasCompleteRegimen(med)}
                            className="mt-3 text-xs font-semibold text-teal-800 border border-teal-300 bg-teal-50 px-3 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                            I checked this medicine, dose and schedule against the image
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Raw Extracted Text Viewer */}
          {extractedText && (
            <details className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-xs">
              <summary className="font-semibold text-gray-700 cursor-pointer flex items-center justify-between">
                <span>📄 View Raw Extracted OCR Text</span>
                <span className="text-gray-400 font-normal">({extractedText.length} characters)</span>
              </summary>
              <pre className="mt-3 p-3 bg-white rounded-lg border border-gray-200 font-mono text-gray-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {extractedText}
              </pre>
            </details>
          )}

        </div>

        {/* Modal Footer */}
        <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={attemptClose}
            disabled={processing}
            className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-sm transition-colors"
          >
            Close
          </button>

          {step === 'complete' ? (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={processing}
              className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Confirm & Save Prescription
            </button>
          ) : (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={processing || !preview}
              className="px-6 py-2.5 bg-gradient-to-r from-teal-600 to-teal-600 hover:from-teal-700 hover:to-teal-700 text-white rounded-xl font-bold text-sm shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {processing ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Analyzing Prescription...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Analyze Prescription
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
