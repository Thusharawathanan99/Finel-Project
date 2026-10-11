import { calendarDateKey } from '../calendar';
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { apiFetch } from '../apiHelper';
import { medicationDetailsComplete, medicationReadyToSave, editMedication } from '../medicationReview';

const UploadRxScreen = ({ route, navigation }) => {
  const { patient } = route.params || { patient: { name: 'Unknown Patient' } };
  const [patientName, setPatientName] = useState(patient.name || 'Unknown Patient');
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
      const asset = result.assets?.[0];
      if (typeof asset?.base64 !== 'string' || !asset.base64.trim()) {
        throw new Error('Could not read the selected image. Please choose it again.');
      }
      const imageData = asset.base64.startsWith('data:')
        ? asset.base64
        : `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
      setImageUri(asset.uri);
      setImageBase64(imageData);
      setExtractedData(null);
      await handleAnalyze(imageData);
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
      setPatientName(data.patient_name && data.patient_name !== 'Needs Review' ? data.patient_name : patient.name || 'Unknown Patient');
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
    const residentId = patient.resident_id || patient.id;
    if (!residentId) {
      Alert.alert('Error', 'No patient ID found.');
      return;
    }
    if (!extractedData || !extractedData.medications || extractedData.medications.length === 0) {
      Alert.alert('Notice', 'No medications to save. Please analyze a prescription first.');
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
      const payload = {
        prescriptionId: draftIdRef.current,
        residentId,
        dateIssued,
        doctorName: doctorName.trim(),
        patientName: patientName || patient.name,
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

      const response = await apiFetch('/prescriptions', { method: 'POST', body: JSON.stringify(payload) });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save the prescription.');
      }

      if (!mountedRef.current) return;
      savedRef.current = true;
      Alert.alert('Success', 'Prescription and medications saved successfully!', [
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
            <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Dashboard')} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={24} color="#171459" />
            </TouchableOpacity>
            <View style={{ flex: 1, paddingHorizontal: 8 }}>
              <Text style={styles.headerTitle}>AI Prescription Reader</Text>
              <Text style={styles.headerSubtitle}>For {patientName}</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.rxHero}>
            <View style={styles.rxIcon}><MaterialCommunityIcons name="file-document-edit-outline" size={32} color="#FFFFFF" /></View>
            <View style={{ flex: 1 }}><Text style={styles.rxEyebrow}>LESS PAPERWORK. MORE CARE.</Text><Text style={styles.rxTitle}>Make prescriptions{'\n'}clearer.</Text><Text style={styles.rxSub}>Upload a clear image, review the details, then save.</Text></View>
            <MaterialCommunityIcons name="star-four-points" size={19} color="#FF887D" style={styles.rxSparkle} />
          </View>
          <View style={styles.stepRail}><View style={styles.stepItem}><Text style={styles.stepNumber}>01</Text><Text style={styles.stepText}>Capture</Text></View><View style={styles.stepLine} /><View style={styles.stepItem}><Text style={styles.stepNumber}>02</Text><Text style={styles.stepText}>Review</Text></View><View style={styles.stepLine} /><View style={styles.stepItem}><Text style={styles.stepNumber}>03</Text><Text style={styles.stepText}>Save</Text></View></View>
          {/* Form */}
          <View style={styles.formSection}>
            <Text style={styles.label}>Select Input Method</Text>
            <View style={styles.methodRow}>
              <TouchableOpacity 
                style={[styles.methodBtn, uploadMethod === 'file' && styles.methodBtnActive]}
                onPress={() => setUploadMethod('file')}
              >
                <MaterialCommunityIcons 
                  name="tray-arrow-up" 
                  size={26}
                  color={uploadMethod === 'file' ? '#6D38FF' : '#9496AA'}
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
                  color={uploadMethod === 'camera' ? '#6D38FF' : '#9496AA'}
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
                    color="#6D38FF"
                    style={{ marginBottom: 10 }}
                  />
                  <Text style={styles.uploadMainText}>
                    {uploadMethod === 'file' ? 'Tap to choose prescription image' : 'Tap to open camera & snap'}
                  </Text>
                  <Text style={styles.uploadSubText}>PNG, JPG (Clear lighting improves accuracy)</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Banner */}
            <View style={styles.banner}>
              <MaterialCommunityIcons name="lightning-bolt" size={16} color="#6D38FF" />
              <Text style={styles.bannerText}>
                <Text style={{ fontWeight: '700' }}>A helping hand for your prescription</Text>
                <Text> — Review extracted details before saving.</Text>
              </Text>
            </View>

            {/* Analysis State */}
            {isAnalyzing && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#6D38FF" />
                <Text style={styles.loadingText}>Extracting and verifying prescription data...</Text>
                <Text style={styles.loadingSubtext}>Reading names, doses and instructions</Text>
              </View>
            )}

            {/* Extracted Data Display */}
            {extractedData && (
              <>
                {/* Header Metadata Card (Doctor, Patient, Date) */}
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <MaterialCommunityIcons name="pill" size={18} color="#065F46" />
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
                {isSubmitting ? 'Saving Prescription...' : `Confirm & Save for ${patientName}`}
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
    flex: 1, backgroundColor: '#F6F5FF',
  },
  scrollContainer: {
    paddingBottom: 40
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 18, backgroundColor: '#F6F5FF',
  },
  closeBtn: {
    width: 46, height: 46, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E6E1FB',
  },
  headerTitle: {
    fontSize: 18, fontWeight: '800', color: '#171459', textAlign: 'center', lineHeight: 25, letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6D38FF',
    textAlign: 'center',
    marginTop: 2,
    fontWeight: '600'
  },
  formSection: {
    marginHorizontal: 22, padding: 20, backgroundColor: '#FFFFFF', borderRadius: 28, borderWidth: 1, borderColor: '#E6E1FB',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#171459',
    marginBottom: 8
  },
  methodRow: {
    flexDirection: 'row', gap: 10, marginBottom: 20,
  },
  methodBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 19, backgroundColor: '#F6F5FF', borderRadius: 21, borderWidth: 1, borderColor: '#E6E1FB',
  },
  methodBtnActive: {
    borderColor: '#6D38FF', backgroundColor: '#EEEBFF', borderWidth: 1.5,
  },
  methodText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#73758E'
  },
  methodTextActive: {
    color: '#171459'
  },
  uploadArea: {
    borderWidth: 1.5, borderColor: '#D8CCFF', borderStyle: 'dashed', backgroundColor: '#F6F5FF', borderRadius: 25, minHeight: 222, padding: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  uploadMainText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#171459',
    marginBottom: 4,
    textAlign: 'center'
  },
  uploadSubText: {
    fontSize: 12,
    color: '#6D38FF',
    textAlign: 'center'
  },
  banner: {
    flexDirection: 'row', backgroundColor: '#EEEBFF', padding: 14, borderRadius: 17, alignItems: 'flex-start', gap: 8, marginBottom: 20,
  },
  bannerText: {
    flex: 1, fontSize: 10, lineHeight: 17, color: '#73758E',
  },
  loadingContainer: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    marginTop: 18,
    borderWidth: 1,
    borderColor: '#EEEBFF'
  },
  loadingText: {
    marginTop: 12,
    color: '#171459',
    fontWeight: '700',
    fontSize: 14
  },
  loadingSubtext: {
    marginTop: 4,
    color: '#73758E',
    fontSize: 12
  },
  metadataCard: {
    padding: 18, backgroundColor: '#F6F5FF', borderRadius: 23, marginBottom: 22, borderWidth: 1, borderColor: '#E6E1FB',
  },
  metadataTitle: {
    fontSize: 17, fontWeight: '800', color: '#171459', marginBottom: 20, letterSpacing: -0.4,
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
    color: '#73758E',
    lineHeight: 18
  },
  metaInput: {
    flex: 0,
    backgroundColor: '#F6F5FF',
    borderWidth: 1,
    borderColor: '#E6E1FB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#171459',
    minHeight: 48
  },
  needsReviewInput: {
    borderColor: '#F59E0B',
    backgroundColor: '#FEF3C7'
  },
  medicationsContainer: {
    marginTop: 18,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 20,
    padding: 16
  },
  medicationsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#065F46'
  },
  verifiedBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#047857'
  },
  medicationCard: {
    padding: 18, backgroundColor: '#FFFFFF', borderRadius: 23, marginBottom: 14, borderWidth: 1, borderColor: '#E6E1FB', borderLeftWidth: 4, borderLeftColor: '#6D38FF',
  },
  medicationCardReview: {
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB'
  },
  medDrugName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827'
  },
  medConfidence: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669'
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
    marginTop: 6,
    gap: 10
  },
  medDetailCol: {
    flex: 1
  },
  medDetailLabel: {
    fontSize: 12,
    color: '#73758E',
    fontWeight: '600',
    lineHeight: 17
  },
  medDetailValue: {
    fontSize: 14,
    color: '#171459',
    fontWeight: '500',
    lineHeight: 20
  },
  needsReviewText: {
    color: '#B45309',
    fontWeight: '700'
  },
  extractedTextContainer: {
    marginTop: 14,
    backgroundColor: '#F6F5FF',
    borderWidth: 1,
    borderColor: '#D8CCFF',
    borderRadius: 14,
    padding: 12
  },
  extractedTextTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#171459'
  },
  extractedTextBg: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#EEEBFF'
  },
  extractedTextContent: {
    fontSize: 11,
    color: '#171459',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EEEBFF'
  },
  submitBtn: { flexDirection: 'row', backgroundColor: '#6D38FF', paddingVertical: 18, paddingHorizontal: 12, borderRadius: 21, alignItems: 'center', justifyContent: 'center', minHeight: 56, shadowColor: '#6D38FF', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.2, shadowRadius: 15, elevation: 3 },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700'
  },
  rxHero: { marginHorizontal: 22, padding: 23, borderRadius: 28, backgroundColor: '#3478FF', flexDirection: 'row', alignItems: 'center', gap: 17, marginTop: 4 },
  rxIcon: { width: 60, height: 74, backgroundColor: '#6D38FF', borderRadius: 21, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] },
  rxEyebrow: { fontSize: 7, letterSpacing: 0.7, color: '#D8CCFF', fontWeight: '800', marginBottom: 9 },
  rxTitle: { fontSize: 24, lineHeight: 28, color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.6 },
  rxSub: { fontSize: 10, lineHeight: 17, color: '#D8CCFF', marginTop: 9 },
  rxSparkle: { position: 'absolute', right: 17, top: 16 },
  stepRail: { marginHorizontal: 25, marginVertical: 23, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepNumber: { fontSize: 9, fontWeight: '800', color: '#6D38FF', backgroundColor: '#EEEBFF', padding: 7, borderRadius: 11 },
  stepText: { fontSize: 10, fontWeight: '700', color: '#73758E' },
  stepLine: { height: 1, backgroundColor: '#D8CCFF', flex: 1 }
});

export default UploadRxScreen;
