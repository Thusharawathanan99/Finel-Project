import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { API_BASE } from '../apiHelper';

const UploadRxScreen = ({ navigation }) => {
  const [doctorName, setDoctorName] = useState('');
  const [uploadMethod, setUploadMethod] = useState('file'); // 'file' or 'camera'
  const [imageUri, setImageUri] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePickImage = async () => {
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

    if (!result.canceled) {
      setImageUri(result.assets[0].uri);
      setImageBase64(result.assets[0].base64);
      setExtractedData(null);
      handleAnalyze(result.assets[0].base64);
    }
  };

  const handleAnalyze = async (base64) => {
    setIsAnalyzing(true);
    try {
      const { auth } = require('../firebase/config');
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : '';

      const res = await fetch(`${API_BASE}/analyze-prescription`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ image: base64 })
      });
      
      if (!res.ok) throw new Error('Ensemble Server Error');
      const data = await res.json();
      
      // Update data to format expected by UI
      setExtractedData({
        raw_text: data.raw_text,
        medications: data.medications
      });
    } catch (err) {
      console.error(err);
      Alert.alert('Analysis Failed', 'Could not extract prescription data.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async () => {
    if (!extractedData) {
      Alert.alert('Error', 'Please upload and analyze a prescription first.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { auth } = require('../firebase/config');
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      const token = await user.getIdToken();
      
      // Look up the user's resident_id from the backend
      let residentId = `R-${user.uid.slice(0, 8).toUpperCase()}`;
      try {
        const userRes = await fetch(`${API_BASE}/users/${user.uid}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          if (userData.resident_id) residentId = userData.resident_id;
        }
      } catch (e) {
        console.warn('Could not fetch user profile, using default resident ID');
      }
      
      const payload = {
        prescriptionId: `RX-${Date.now()}`,
        residentId,
        dateIssued: new Date().toISOString().split('T')[0],
        doctorName: doctorName || 'Unknown Doctor',
        medications: extractedData.medications || []
      };

      const res = await fetch(`${API_BASE}/prescriptions`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save prescription');
      }
      Alert.alert('Success', 'Prescription saved successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      console.error(err);
      Alert.alert('Submission Failed', err.message || 'Could not save the prescription.');
    } finally {
      setIsSubmitting(false);
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
              <MaterialCommunityIcons name="close" size={24} color="#64748B" />
            </TouchableOpacity>
            <View>
              <Text style={styles.headerTitle}>Upload Prescription</Text>
              <Text style={styles.headerSubtitle}>For Patient</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <Text style={styles.label}>Prescribing Doctor's Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Dr. John Smith"
              placeholderTextColor="#9CA3AF"
              value={doctorName}
              onChangeText={setDoctorName}
            />

            <Text style={[styles.label, { marginTop: 24 }]}>Upload Method</Text>
            <View style={styles.methodRow}>
              <TouchableOpacity 
                style={[styles.methodBtn, uploadMethod === 'file' && styles.methodBtnActive]}
                onPress={() => setUploadMethod('file')}
              >
                <MaterialCommunityIcons 
                  name="tray-arrow-up" 
                  size={28} 
                  color={uploadMethod === 'file' ? '#3B82F6' : '#94A3B8'} 
                  style={{ marginBottom: 8 }}
                />
                <Text style={[styles.methodText, uploadMethod === 'file' && styles.methodTextActive]}>Upload File</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.methodBtn, uploadMethod === 'camera' && styles.methodBtnActive]}
                onPress={() => setUploadMethod('camera')}
              >
                <MaterialCommunityIcons 
                  name="camera-outline" 
                  size={28} 
                  color={uploadMethod === 'camera' ? '#3B82F6' : '#94A3B8'} 
                  style={{ marginBottom: 8 }}
                />
                <Text style={[styles.methodText, uploadMethod === 'camera' && styles.methodTextActive]}>Take Photo</Text>
              </TouchableOpacity>
            </View>

            {/* Upload Area */}
            <TouchableOpacity style={styles.uploadArea} onPress={handlePickImage}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={{ width: '100%', height: 200, borderRadius: 12 }} resizeMode="cover" />
              ) : (
                <>
                  <MaterialCommunityIcons 
                    name={uploadMethod === 'file' ? "file-document-outline" : "camera-plus"} 
                    size={56} 
                    color="#CBD5E1" 
                    style={{ marginBottom: 12 }}
                  />
                  <Text style={styles.uploadMainText}>
                    {uploadMethod === 'file' ? 'Click to upload' : 'Click to take photo'}
                  </Text>
                  <Text style={styles.uploadSubText}>PNG, JPG up to 10MB</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Banner */}
            <View style={styles.banner}>
              <MaterialCommunityIcons name="lightning-bolt" size={16} color="#8B5CF6" />
              <Text style={styles.bannerText}>
                <Text style={{ fontWeight: '700' }}>Ensemble Mode Active</Text>
                <Text> — (Donut (cpu) + Regex + Gemini)</Text>
              </Text>
            </View>

            {/* Analysis State */}
            {isAnalyzing && (
              <View style={{ alignItems: 'center', marginTop: 32 }}>
                <ActivityIndicator size="large" color="#3B82F6" />
                <Text style={{ marginTop: 12, color: '#1D4ED8', fontWeight: '600' }}>Analyzing Prescription via Donut ML...</Text>
              </View>
            )}

            {/* Extracted Data Display */}
            {extractedData && (
              <>
                <View style={styles.extractedTextContainer}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <MaterialCommunityIcons name="file-document-outline" size={18} color="#1E3A8A" />
                    <Text style={styles.extractedTextTitle}> Raw Extracted Text</Text>
                  </View>
                  <View style={styles.extractedTextBg}>
                    <Text style={styles.extractedTextContent}>
                      {extractedData.raw_text || "No text extracted."}
                    </Text>
                  </View>
                </View>

                <View style={styles.medicationsContainer}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <MaterialCommunityIcons name="pill" size={18} color="#065F46" />
                      <Text style={styles.medicationsTitle}> Parsed Medications</Text>
                    </View>
                    <View style={styles.verifiedBadge}>
                      <Text style={styles.verifiedBadgeText}>🧠 Ensemble Verified</Text>
                    </View>
                  </View>

                  {(extractedData.medications || []).map((med, index) => {
                    const dosageText = med.dosage || 'No dosage specified';
                    const freqText = med.frequency || 'As directed';
                    const confPct = med.confidence ? `${Math.round(med.confidence * 100)}%` : '—';
                    return (
                    <View key={index} style={styles.medicationCard}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <MaterialCommunityIcons name="pill" size={20} color="#059669" style={{ marginRight: 12 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.medDrugName}>{med.drugName}</Text>
                          <Text style={styles.medDosage}>{dosageText} — {freqText}</Text>
                        </View>
                        <Text style={styles.medConfidence}>{confPct}</Text>
                      </View>
                    </View>
                    );
                  })}
                </View>
              </>
            )}

          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity 
            style={[styles.submitBtn, isSubmitting && { opacity: 0.7 }]}
            onPress={handleSubmit}
          >
            <MaterialCommunityIcons name="check-circle-outline" size={24} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.submitBtnText}>
              {isSubmitting ? 'Saving...' : 'Confirm & Save'}
            </Text>
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContainer: { paddingBottom: 40 },
  
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9'
  },
  closeBtn: { padding: 8, backgroundColor: '#F1F5F9', borderRadius: 20 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1E293B', textAlign: 'center' },
  headerSubtitle: { fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 2 },

  formSection: { padding: 24 },
  label: { fontSize: 15, fontWeight: '600', color: '#334155', marginBottom: 10 },
  input: { 
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', 
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, 
    fontSize: 16, color: '#0F172A' 
  },

  methodRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  methodBtn: {
    flex: 1, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#F1F5F9',
    borderRadius: 16, padding: 16, alignItems: 'center'
  },
  methodBtnActive: { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' },
  methodText: { fontSize: 14, fontWeight: '600', color: '#64748B' },
  methodTextActive: { color: '#1D4ED8' },

  uploadArea: {
    backgroundColor: '#F8FAFC', borderWidth: 2, borderColor: '#E2E8F0', borderStyle: 'dashed',
    borderRadius: 20, padding: 40, alignItems: 'center', marginBottom: 24
  },
  uploadMainText: { fontSize: 16, fontWeight: '600', color: '#475569', marginBottom: 4 },
  uploadSubText: { fontSize: 13, color: '#94A3B8' },

  banner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F3FF',
    borderWidth: 1, borderColor: '#EDE9FE', borderRadius: 12, padding: 12
  },
  bannerText: { fontSize: 12, color: '#7C3AED', marginLeft: 8 },

  extractedTextContainer: {
    marginTop: 24, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE',
    borderRadius: 16, padding: 16
  },
  extractedTextTitle: { fontSize: 14, fontWeight: '700', color: '#1E3A8A' },
  extractedTextBg: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#DBEAFE' },
  extractedTextContent: { fontSize: 13, color: '#1E40AF', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  medicationsContainer: {
    marginTop: 16, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0',
    borderRadius: 16, padding: 16
  },
  medicationsTitle: { fontSize: 14, fontWeight: '700', color: '#065F46' },
  verifiedBadge: { backgroundColor: '#EDE9FE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  verifiedBadgeText: { fontSize: 10, fontWeight: '700', color: '#5B21B6' },
  medicationCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1FAE5',
    borderRadius: 12, padding: 12, marginBottom: 8
  },
  medDrugName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  medDosage: { fontSize: 12, color: '#4B5563', marginTop: 2 },
  medConfidence: { fontSize: 12, fontWeight: '600', color: '#6B7280' },

  footer: { 
    padding: 20, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F1F5F9' 
  },
  submitBtn: {
    flexDirection: 'row', backgroundColor: '#10B981', paddingVertical: 16,
    borderRadius: 16, alignItems: 'center', justifyContent: 'center'
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }
});

export default UploadRxScreen;
