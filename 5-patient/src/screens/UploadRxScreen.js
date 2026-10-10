import { calendarDateKey } from '../calendar';
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, getResidentId } from '../apiHelper';
import { auth } from '../firebase/config';
import { medicationDetailsComplete, medicationReadyToSave, editMedication } from '../medicationReview';

const UploadRxScreen = ({ navigation }) => {
  const [patientName, setPatientName] = useState('Patient');
  const [doctorName, setDoctorName] = useState('');
  const [dateIssued, setDateIssued] = useState('');
  const [uploadMethod, setUploadMethod] = useState('file'); // 'file' or 'camera'
  const [imageUri, setImageUri] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRawText, setShowRawText] = useState(false);

  const draftIdRef = useRef(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const analyzingRef = useRef(false);
  const submittingRef = useRef(false);
  const pickerRef = useRef(false);
  const controllerRef = useRef(null);
  const savedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => navigation.addListener?.('beforeRemove', event => {
    const hasDraft = Boolean(imageUri || doctorName.trim() || dateIssued || extractedData);
    if (!hasDraft || savedRef.current) return;
    event.preventDefault();
    Alert.alert(
      'Discard Prescription Draft?',
      'Your selected image and reviewed medication details have not been saved.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { savedRef.current = true; navigation.dispatch(event.data.action); } },
      ]
    );
  }), [navigation, imageUri, doctorName, dateIssued, extractedData]);

  const handlePickImage = async () => {
    if (submittingRef.current || pickerRef.current || analyzingRef.current) return;
    pickerRef.current = true;
    try {
    let result;
    if (uploadMethod === 'file') {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });
    } else {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required to take photos.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });
    }

    if (mountedRef.current && !result.canceled) {
      setImageUri(result.assets[0].uri);
      setImageBase64(result.assets[0].base64);
      setExtractedData(null);
      await handleAnalyze(result.assets[0].base64);
    }
    } catch (error) {
      if (mountedRef.current) Alert.alert('Upload Failed', error.message || 'Could not select the prescription image.');
    } finally {
      pickerRef.current = false;
    }
  };

  const handleAnalyze = async (base64) => {
    if (!base64 || submittingRef.current) return;
    const requestId = ++requestIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    analyzingRef.current = true;
    setIsAnalyzing(true);
    setExtractedData(null);
    try {
      const response = await apiFetch('/analyze-prescription', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ image: base64 }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Could not analyze this prescription. Please try again.');
      }
      const data = await response.json();
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setDoctorName(data.doctor_name && data.doctor_name !== 'Needs Review' ? data.doctor_name : '');
      setPatientName(data.patient_name && data.patient_name !== 'Needs Review' ? data.patient_name : auth.currentUser?.displayName || 'Patient');
      setDateIssued(calendarDateKey(data.date));
      setExtractedData({ ...data, medications: (data.medications || []).map(medication => ({ ...medication, reviewed: false })) });
    } catch (error) {
      if (mountedRef.current && requestIdRef.current === requestId && error.name !== 'AbortError') {
        Alert.alert('Analysis Failed', error.message || 'Could not extract prescription data.');
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        analyzingRef.current = false;
        setIsAnalyzing(false);
      }
    }
  };

  const blankMedication = () => ({ drugName: '', dosage: '', frequency: '', duration: '', instructions: '', source: 'manual', confidence: null, reviewed: false });
  const beginManual = () => {
    if (analyzingRef.current || submittingRef.current || pickerRef.current) return;
    setExtractedData(previous => previous || { raw_text: '', medications: [blankMedication()] });
  };
  const addMedication = () => {
    if (submittingRef.current) return;
    setExtractedData(previous => ({ ...previous, medications: [...previous.medications, blankMedication()] }));
  };
  const removeMedication = index => {
    if (submittingRef.current) return;
    setExtractedData(previous => ({ ...previous, medications: previous.medications.filter((_, row) => row !== index) }));
  };
  const updateMedication = (index, field, value) => {
    if (submittingRef.current) return;
    setExtractedData(previous => ({ ...previous, medications: previous.medications.map((medication, i) =>
      i === index ? editMedication(medication, field, value) : medication) }));
  };

  const toggleMedicationReview = (index) => {
    if (submittingRef.current) return;
    setExtractedData(previous => ({ ...previous, medications: previous.medications.map((medication, i) =>
      i === index && medicationDetailsComplete(medication) ? { ...medication, reviewed: !medication.reviewed } : medication) }));
  };

  const handleSubmit = async () => {
    if (analyzingRef.current || pickerRef.current || submittingRef.current) return;
    if (!extractedData || !extractedData.medications || extractedData.medications.length === 0) {
      Alert.alert('Error', 'Please upload and analyze a prescription first.');
      return;
    }
    if (!extractedData.medications.every(medicationReadyToSave)) {
      Alert.alert('Review Required', 'Check each medicine against the prescription, fill in its drug, dosage and schedule, then mark it verified before saving.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIssued) || calendarDateKey(dateIssued) !== dateIssued) {
      Alert.alert('Check Issue Date', 'Enter the issue date from the prescription as YYYY-MM-DD. If it is unreadable, confirm it with your care team before saving.');
      return;
    }
    if (!draftIdRef.current) draftIdRef.current = `RX-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const residentId = await getResidentId();

      const payload = {
        prescriptionId: draftIdRef.current,
        residentId,
        dateIssued,
        doctorName: doctorName.trim(),
        patientName: patientName || user.displayName || 'Patient',
        rawText: extractedData.raw_text || '',
        medications: (extractedData.medications || []).map(m => ({
          drugName: m.drugName,
          dosage: m.dosage.trim(),
          frequency: m.frequency.trim(),
          duration: m.duration || '',
          instructions: m.instructions || '',
          confidence: m.confidence ?? 0,
          confirmed: true,
          source: m.source || 'manual_review',
          needsReview: Boolean(m.needsReview),
          reviewReasons: m.reviewReasons || [],
          evidence: m.evidence || {}
        }))
      };

      const res = await apiFetch('/prescriptions', { method: 'POST', body: JSON.stringify(payload) });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save prescription');
      }
      if (!mountedRef.current) return;
      savedRef.current = true;
      Alert.alert('Success', 'Prescription saved successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      console.error(err);
      if (mountedRef.current) Alert.alert('Submission Failed', err.message || 'Could not save the prescription.');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={24} color="#171459" />
            </TouchableOpacity>
            <View>
              <Text style={styles.headerTitle}>AI Prescription Reader</Text>
              <Text style={styles.headerSubtitle}>Self Upload & OCR</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.introHero}>
            <View pointerEvents="none" style={styles.heroOrb} />
          <View pointerEvents="none" style={styles.heroOrbSmall} />
            <Text style={styles.heroEyebrow}>YOUR PRESCRIPTION, MADE CLEAR</Text>
            <Text style={styles.introTitle}>A little clarity.{'\n'}Better care.</Text>
            <Text style={styles.introCaption}>Keep your prescription details close at hand.</Text>
            <View style={styles.introIcon}><MaterialCommunityIcons name="file-document-outline" size={26} color="#FFFFFF" /></View>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <Text style={styles.label}>Choose Input Method</Text>
            <View style={styles.methodRow}>
              <TouchableOpacity 
                style={[styles.methodBtn, uploadMethod === 'file' && styles.methodBtnActive]}
                onPress={() => setUploadMethod('file')}
              >
                <MaterialCommunityIcons 
                  name="tray-arrow-up" 
                  size={26}
                  color={uploadMethod === 'file' ? '#0B786C' : '#788C82'}
                  style={{ marginBottom: 6 }}
                />
                <Text style={[styles.methodText, uploadMethod === 'file' && styles.methodTextActive]}>Upload File</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.methodBtn, uploadMethod === 'camera' && styles.methodBtnActive]}
                onPress={() => setUploadMethod('camera')}
              >
                <MaterialCommunityIcons 
                  name="camera-outline" 
                  size={26}
                  color={uploadMethod === 'camera' ? '#0B786C' : '#788C82'}
                  style={{ marginBottom: 6 }}
                />
                <Text style={[styles.methodText, uploadMethod === 'camera' && styles.methodTextActive]}>Take Photo</Text>
              </TouchableOpacity>
            </View>

            {/* Upload Area */}
            <TouchableOpacity accessibilityRole="button" disabled={isAnalyzing || isSubmitting} onPress={beginManual}><Text style={{paddingVertical:14,color:'#6D38FF',fontWeight:'700'}}>Enter prescription manually</Text></TouchableOpacity>
            <TouchableOpacity style={styles.uploadArea} onPress={handlePickImage} disabled={isAnalyzing || isSubmitting}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={{ width: '100%', height: 210, borderRadius: 12 }} resizeMode="cover" />
              ) : (
                <>
                  <MaterialCommunityIcons 
                    name={uploadMethod === 'file' ? "file-document-outline" : "camera-plus"} 
                    size={52}
                    color="#5355B7"
                    style={{ marginBottom: 10 }}
                  />
                  <Text style={styles.uploadMainText}>
                    {uploadMethod === 'file' ? 'Tap to select prescription file' : 'Tap to open camera & snap'}
                  </Text>
                  <Text style={styles.uploadSubText}>PNG, JPG (Clear lighting improves accuracy)</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Banner */}
            <View style={styles.banner}>
              <MaterialCommunityIcons name="lightning-bolt" size={16} color="#5355B7" />
              <Text style={styles.bannerText}>
                <Text style={{ fontWeight: '700' }}>AI Ensemble Mode</Text>
                <Text> — Donut OCR + Clinical AI Extraction</Text>
              </Text>
            </View>

            {/* Analysis State */}
            {isAnalyzing && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#5355B7" />
                <Text style={styles.loadingText}>Reading and extracting prescription...</Text>
                <Text style={styles.loadingSubtext}>Running OCR & clinical entity recognition</Text>
              </View>
            )}

            {/* Extracted Data Display */}
            {extractedData && (
              <>
                {/* Header Metadata Card */}
                <View style={styles.metadataCard}>
                  <Text style={styles.metadataTitle}>Prescription Information</Text>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Patient Name:</Text>
                    <TextInput
                      style={styles.metaInput}
                      value={patientName}
                      onChangeText={setPatientName}
                      placeholder="Patient Name"
                    />
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Doctor Name:</Text>
                    <TextInput
                      style={[styles.metaInput, (!doctorName || doctorName === 'Needs Review') && styles.needsReviewInput]}
                      value={doctorName}
                      onChangeText={setDoctorName}
                      placeholder="Doctor Name (e.g. Dr. Smith)"
                    />
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Date Issued:</Text>
                    <TextInput
                      style={styles.metaInput}
                      value={dateIssued}
                      onChangeText={setDateIssued}
                      placeholder="YYYY-MM-DD — confirm from prescription"
                    />
                  </View>
                </View>

                {/* Medications List */}
                <View style={styles.medicationsContainer}>
                  <View style={styles.medicationsHeader}>
                    <View style={styles.medicationsHeading}>
                      <MaterialCommunityIcons name="pill" size={18} color="#171459" />
                      <Text style={styles.medicationsTitle}> Prescribed Medications ({extractedData.medications.length})</Text>
                    </View>
                    <View style={styles.verifiedBadge}>
                      <Text style={styles.verifiedBadgeText}>Check Against Image</Text>
                    </View>
                  </View>

                  <TouchableOpacity accessibilityRole="button" disabled={isSubmitting} onPress={addMedication}><Text style={{padding:14,color:'#6D38FF',fontWeight:'700'}}>Add medication row</Text></TouchableOpacity>
                  {(extractedData.medications || []).map((med, index) => {
                    const isNeedsReview = !medicationReadyToSave(med);
                    const confidence = Number.isFinite(med.confidence) ? `${Math.round(med.confidence * 100)}% extraction confidence` : 'Confidence unavailable';
                    return (
                      <View key={index} style={[styles.medicationCard, isNeedsReview && styles.medicationCardReview]}>
                        <TouchableOpacity accessibilityLabel={`Remove medicine ${index + 1}`} disabled={isSubmitting} onPress={() => removeMedication(index)}><Text style={{paddingVertical:12,color:'#991B1B'}}>Delete medication row</Text></TouchableOpacity>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                          <View style={{ flex: 1 }}>
                            <TextInput accessibilityLabel={`Medicine ${index + 1} name`} style={[styles.metaInput, styles.medDrugName]} value={med.drugName || ''} onChangeText={value => updateMedication(index, 'drugName', value)} editable={!isSubmitting} placeholder="Medicine name" />
                          </View>
                          {isNeedsReview ? (
                            <View style={styles.needsReviewBadge}>
                              <Text style={styles.needsReviewBadgeText}>⚠️ Needs Review</Text>
                            </View>
                          ) : (
                            <Text style={styles.medConfidence}>Verified by you</Text>
                          )}
                        </View>

                        <Text style={styles.medConfidence}>{confidence}</Text>
                        {(med.reviewReasons || []).map((reason, reasonIndex) => <Text key={reasonIndex} style={styles.needsReviewText}>{reason}</Text>)}
                        {/* 4 Details Grid: Dosage, Frequency, Duration, Instructions */}
                        <View style={styles.medDetailsGrid}>
                          <View style={styles.medDetailCol}>
                            <Text style={styles.medDetailLabel}>Dosage:</Text>
                            <TextInput accessibilityLabel={`Medicine ${index + 1} dosage`} style={styles.metaInput} value={med.dosage || ''} onChangeText={value => updateMedication(index, 'dosage', value)} editable={!isSubmitting} placeholder="Dose on prescription" />
                          </View>
                          <View style={styles.medDetailCol}>
                            <Text style={styles.medDetailLabel}>Frequency:</Text>
                            <TextInput accessibilityLabel={`Medicine ${index + 1} schedule`} style={styles.metaInput} value={med.frequency || ''} onChangeText={value => updateMedication(index, 'frequency', value)} editable={!isSubmitting} placeholder="Schedule / days" multiline />
                          </View>
                        </View>

                        <View style={styles.medDetailsGrid}>
                          <View style={styles.medDetailCol}>
                            <Text style={styles.medDetailLabel}>Duration:</Text>
                            <TextInput accessibilityLabel={`Medicine ${index + 1} duration`} style={styles.metaInput} value={med.duration || ''} onChangeText={value => updateMedication(index, 'duration', value)} editable={!isSubmitting} placeholder="If prescribed" />
                          </View>
                          <View style={styles.medDetailCol}>
                            <Text style={styles.medDetailLabel}>Instructions:</Text>
                            <TextInput accessibilityLabel={`Medicine ${index + 1} instructions`} style={styles.metaInput} value={med.instructions || ''} onChangeText={value => updateMedication(index, 'instructions', value)} editable={!isSubmitting} placeholder="If prescribed" multiline />
                          </View>
                        </View>
                        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: med.reviewed === true }} disabled={isSubmitting || !medicationDetailsComplete(med)} onPress={() => toggleMedicationReview(index)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8, opacity: medicationDetailsComplete(med) ? 1 : 0.5 }}>
                          <MaterialCommunityIcons name={med.reviewed ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color="#6D38FF" />
                          <Text style={{ flex: 1, color: '#171459', fontSize: 12 }}>I checked this medicine, dose and schedule against the prescription.</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>

                {/* Raw Extracted Text Viewer Toggle */}
                {extractedData.raw_text ? (
                  <View style={styles.extractedTextContainer}>
                    <TouchableOpacity
                      onPress={() => setShowRawText(!showRawText)}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MaterialCommunityIcons name="file-document-outline" size={18} color="#171459" />
                        <Text style={styles.extractedTextTitle}> Raw OCR Extracted Text</Text>
                      </View>
                      <MaterialCommunityIcons name={showRawText ? "chevron-up" : "chevron-down"} size={20} color="#171459" />
                    </TouchableOpacity>
                    {showRawText && (
                      <View style={styles.extractedTextBg}>
                        <Text style={styles.extractedTextContent}>
                          {extractedData.raw_text}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null}
              </>
            )}

          </View>
        </ScrollView>

        {/* Footer */}
        {extractedData && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, isSubmitting && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={isSubmitting || isAnalyzing}
            >
              <MaterialCommunityIcons name="check-circle-outline" size={22} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.submitBtnText}>
                {isSubmitting ? 'Saving Prescription...' : 'Confirm & Save Prescription'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F6F5FF"
  },
  scrollContainer: {
    paddingBottom: 34,
    padding: 0
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: "#F6F5FF",
    borderBottomWidth: 0,
    borderBottomColor: "#E4E3F4"
  },
  closeBtn: {
    padding: 8,
    backgroundColor: "#EEE9FF",
    borderRadius: 17,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    width: 46,
    height: 46
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#171459",
    textAlign: "left",
    lineHeight: 25,
    letterSpacing: -0.5
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#6B6F91",
    textAlign: "left",
    marginTop: 2,
    fontWeight: '600',
    lineHeight: 17
  },
  formSection: {
    padding: 20
  },
  label: {
    fontSize: 17,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 13,
    lineHeight: 24,
    letterSpacing: -0.3
  },
  methodRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20
  },
  methodBtn: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 0,
    borderColor: "#E4E3F4",
    borderRadius: 24,
    padding: 19,
    alignItems: 'center',
    minHeight: 108
  },
  methodBtnActive: {
    borderColor: "#6D38FF",
    backgroundColor: "#EEE9FF",
    borderWidth: 2,
    padding: 17
  },
  methodText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6B6F91",
    lineHeight: 21
  },
  methodTextActive: {
    color: "#171459"
  },
  uploadArea: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#BBBDF0",
    borderStyle: 'dashed',
    borderRadius: 30,
    padding: 28,
    alignItems: 'center',
    marginBottom: 18,
    minHeight: 224,
    justifyContent: "center"
  },
  uploadMainText: {
    fontSize: 17,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 4,
    textAlign: 'center',
    lineHeight: 24,
    letterSpacing: -0.3
  },
  uploadSubText: {
    fontSize: 12,
    color: "#6B6F91",
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: "#EEE9FF",
    borderWidth: 0,
    borderColor: '#93C5FD',
    borderRadius: 18,
    padding: 13
  },
  bannerText: {
    fontSize: 12,
    color: "#424581",
    marginLeft: 8,
    flex: 1,
    lineHeight: 20
  },
  loadingContainer: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: 26,
    marginTop: 18,
    borderWidth: 0,
    borderColor: "#E4E3F4"
  },
  loadingText: {
    marginTop: 12,
    color: "#171459",
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center"
  },
  loadingSubtext: {
    marginTop: 4,
    color: "#6B6F91",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center"
  },
  metadataCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 0,
    borderColor: "#E4E3F4",
    borderRadius: 28,
    padding: 20,
    marginTop: 22
  },
  metadataTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 18,
    lineHeight: 26,
    letterSpacing: -0.5
  },
  metaRow: {
    flexDirection: "column",
    alignItems: "stretch",
    marginBottom: 14,
    gap: 6
  },
  metaLabel: {
    width: "100%",
    fontSize: 13,
    fontWeight: '600',
    color: "#6B6F91",
    lineHeight: 18
  },
  metaInput: {
    flex: 0,
    backgroundColor: "#F6F5FF",
    borderWidth: 1,
    borderColor: "#E4E3F4",
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 15,
    color: "#171459",
    minHeight: 52
  },
  needsReviewInput: {
    borderColor: '#F59E0B',
    backgroundColor: '#FEF3C7'
  },
  medicationsContainer: {
    marginTop: 20,
    backgroundColor: "#EEE9FF",
    borderWidth: 0,
    borderColor: "#DAD8F8",
    borderRadius: 28,
    padding: 18
  },
  medicationsTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#171459",
    lineHeight: 22,
    flexShrink: 1
  },
  verifiedBadge: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: "#171459"
  },
  medicationCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 0,
    borderColor: "#E4E3F4",
    borderRadius: 22,
    padding: 17,
    marginBottom: 12
  },
  medicationCardReview: {
    borderColor: "#E1AE51",
    backgroundColor: "#FFFBEB",
    borderWidth: 1
  },
  medDrugName: {
    fontSize: 19,
    fontWeight: "800",
    color: "#171459",
    lineHeight: 25,
    letterSpacing: -0.5
  },
  medConfidence: {
    fontSize: 11,
    fontWeight: '600',
    color: "#5355B7"
  },
  needsReviewBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6
  },
  needsReviewBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309'
  },
  medDetailsGrid: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 13
  },
  medDetailCol: {
    flex: 1
  },
  medDetailLabel: {
    fontSize: 12,
    color: "#6B6F91",
    fontWeight: '600',
    lineHeight: 17
  },
  medDetailValue: {
    fontSize: 14,
    color: "#171459",
    fontWeight: '500',
    lineHeight: 22
  },
  needsReviewText: {
    color: '#B45309',
    fontWeight: '700'
  },
  extractedTextContainer: {
    marginTop: 14,
    backgroundColor: "#EEE9FF",
    borderWidth: 0,
    borderColor: "#DAD8F8",
    borderRadius: 22,
    padding: 16
  },
  extractedTextTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: "#171459"
  },
  extractedTextBg: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginTop: 8,
    borderWidth: 0,
    borderColor: "#E4E3F4"
  },
  extractedTextContent: {
    fontSize: 11,
    color: "#171459",
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'
  },
  footer: {
    padding: 20,
    backgroundColor: "#F6F5FF",
    borderTopWidth: 0,
    borderTopColor: "#E4E3F4",
    paddingTop: 12
  },
  submitBtn: {
    flexDirection: 'row',
    backgroundColor: "#171459",
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 58,
    shadowColor: "#171459",
    shadowOpacity: 0.12,
    paddingHorizontal: 12
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: "center",
    flexShrink: 1
  },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: "#EEE9FF"
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginBottom: 16
  },
  emptyState: {
    borderRadius: 30,
    padding: 26,
    borderWidth: 0,
    backgroundColor: "#FFFFFF",
    paddingVertical: 36
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "800",
    letterSpacing: -0.4
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 23
  },
  listContainer: {
    gap: 16
  },
  bannerCard: {
    backgroundColor: "#171459",
    borderRadius: 32,
    padding: 24,
    minHeight: 178,
    marginBottom: 26,
    borderWidth: 0,
    shadowColor: "#171459",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 5,
    overflow: "hidden"
  },
  bannerTitle: {
    fontSize: 29,
    lineHeight: 34,
    letterSpacing: -1,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 9
  },
  bannerSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: "#DAD9FF",
    fontWeight: "500"
  },
  heroCopy: {
    flex: 1,
    paddingRight: 12
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    color: "#BEBEFF",
    letterSpacing: 2,
    marginBottom: 13
  },
  heroOrb: {
    position: "absolute",
    width: 156,
    height: 156,
    borderRadius: 78,
    top: -68,
    right: -46,
    backgroundColor: "#6D38FF",
    opacity: 0.24
  },
  heroOrbSmall: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    right: 35,
    bottom: -38,
    backgroundColor: "#FFB85C",
    opacity: 0.72
  },
  confirmBtn: {
    backgroundColor: "#171459",
    borderRadius: 20,
    minHeight: 56
  },
  introHero: {
    backgroundColor: "#171459",
    borderRadius: 32,
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 8,
    minHeight: 176,
    padding: 24,
    overflow: "hidden"
  },
  introTitle: {
    color: "#FFFFFF",
    fontSize: 32,
    lineHeight: 37,
    letterSpacing: -1.2,
    fontWeight: "800",
    maxWidth: 232
  },
  introCaption: {
    color: "#DAD9FF",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
    maxWidth: 240
  },
  introIcon: {
    position: "absolute",
    right: 24,
    bottom: 24,
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: "#6D38FF",
    alignItems: "center",
    justifyContent: "center"
  },
  medicationsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14
  },
  medicationsHeading: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    flex: 1
  }
});

export default UploadRxScreen;
