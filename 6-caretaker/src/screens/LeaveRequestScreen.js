import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

const LeaveRequestScreen = ({ navigation }) => {
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date(Date.now() + 86400000));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Leave history
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [activeTab, setActiveTab] = useState('request'); // 'request' | 'history'

  useEffect(() => {
    fetchLeaveHistory();
  }, []);

  const getCaretakerId = async () => {
    const { auth } = require('../firebase/config');
    const user = auth.currentUser;
    return user?.uid;
  };

  const fetchLeaveHistory = async () => {
    try {
      const { auth } = require('../firebase/config');
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch(`https://api.careconnect.website/api/caretakers/${user.uid}/leave-requests`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLeaveHistory(data);
      }
    } catch (err) {
      console.warn('[Leave] History fetch error:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const formatDate = (date) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatDateISO = (date) => {
    return date.toISOString().split('T')[0];
  };

  const getDayCount = () => {
    const diff = endDate - startDate;
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'approved':
        return { bg: '#DCFCE7', text: '#166534', icon: 'check-circle', label: 'Approved' };
      case 'rejected':
        return { bg: '#FEE2E2', text: '#991B1B', icon: 'close-circle', label: 'Rejected' };
      default:
        return { bg: '#FEF9C3', text: '#854D0E', icon: 'clock-outline', label: 'Pending' };
    }
  };

  const handleSubmit = async () => {
    if (!reason.trim()) {
      Alert.alert('Missing Reason', 'Please provide a reason for your leave request.');
      return;
    }

    if (endDate < startDate) {
      Alert.alert('Invalid Dates', 'End date cannot be before start date.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { auth } = require('../firebase/config');
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      const token = await user.getIdToken();

      const payload = {
        startDate: formatDateISO(startDate),
        endDate: formatDateISO(endDate),
        reason: reason.trim(),
        caretakerName: user.displayName || 'Caretaker'
      };

      const res = await fetch(`https://api.careconnect.website/api/caretakers/${user.uid}/leave-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to submit leave request');

      Alert.alert(
        'Request Submitted ✓',
        `Leave request for ${getDayCount()} day(s) has been sent to admin for approval.`,
        [{
          text: 'OK', onPress: () => {
            setReason('');
            setActiveTab('history');
            fetchLeaveHistory();
          }
        }]
      );
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Could not submit leave request. Please try again later.');
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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
            <MaterialCommunityIcons name="arrow-left" size={22} color="#0F766E" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Leave Management</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Tab Selector */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'request' && styles.tabActive]}
            onPress={() => setActiveTab('request')}
          >
            <MaterialCommunityIcons name="calendar-plus" size={18} color={activeTab === 'request' ? '#0D9488' : '#9CA3AF'} />
            <Text style={[styles.tabText, activeTab === 'request' && styles.tabTextActive]}>New Request</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'history' && styles.tabActive]}
            onPress={() => setActiveTab('history')}
          >
            <MaterialCommunityIcons name="history" size={18} color={activeTab === 'history' ? '#0D9488' : '#9CA3AF'} />
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>My History</Text>
            {leaveHistory.filter(l => l.status === 'pending').length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{leaveHistory.filter(l => l.status === 'pending').length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {activeTab === 'request' ? (
          <>
            <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
              <View style={styles.formSection}>
                <View style={styles.banner}>
                  <MaterialCommunityIcons name="information" size={20} color="#0D9488" />
                  <Text style={styles.bannerText}>
                    Leave requests require at least 48 hours notice. Admin will review and approve your request.
                  </Text>
                </View>

                {/* Start Date */}
                <Text style={styles.label}>Start Date</Text>
                <TouchableOpacity style={styles.dateButton} onPress={() => setShowStartPicker(true)}>
                  <MaterialCommunityIcons name="calendar-start" size={22} color="#0D9488" />
                  <Text style={styles.dateText}>{formatDate(startDate)}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#9CA3AF" />
                </TouchableOpacity>
                {showStartPicker && (
                  <DateTimePicker
                    value={startDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
                    minimumDate={new Date()}
                    onChange={(event, date) => {
                      setShowStartPicker(false);
                      if (date) {
                        setStartDate(date);
                        if (date > endDate) setEndDate(date);
                      }
                    }}
                  />
                )}

                {/* End Date */}
                <Text style={styles.label}>End Date</Text>
                <TouchableOpacity style={styles.dateButton} onPress={() => setShowEndPicker(true)}>
                  <MaterialCommunityIcons name="calendar-end" size={22} color="#0D9488" />
                  <Text style={styles.dateText}>{formatDate(endDate)}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#9CA3AF" />
                </TouchableOpacity>
                {showEndPicker && (
                  <DateTimePicker
                    value={endDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
                    minimumDate={startDate}
                    onChange={(event, date) => {
                      setShowEndPicker(false);
                      if (date) setEndDate(date);
                    }}
                  />
                )}

                {/* Duration chip */}
                <View style={styles.durationChip}>
                  <MaterialCommunityIcons name="clock-outline" size={16} color="#7C3AED" />
                  <Text style={styles.durationText}>{getDayCount()} day{getDayCount() > 1 ? 's' : ''} leave</Text>
                </View>

                {/* Reason */}
                <Text style={styles.label}>Reason for Leave</Text>
                <View style={[styles.inputWrapper, { alignItems: 'flex-start' }]}>
                  <MaterialCommunityIcons name="text-box-outline" size={20} color="#9CA3AF" style={{ marginTop: 14, marginRight: 12 }} />
                  <TextInput
                    style={styles.textArea}
                    placeholder="Explain the reason for your leave request..."
                    placeholderTextColor="#9CA3AF"
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    textAlignVertical="top"
                    numberOfLines={4}
                  />
                </View>
              </View>
            </ScrollView>

            {/* Submit */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.submitBtn, (!reason.trim() || isSubmitting) && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={!reason.trim() || isSubmitting}
              >
                <MaterialCommunityIcons name="send" size={20} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.submitBtnText}>{isSubmitting ? 'Submitting...' : 'Submit Request'}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          /* Leave History Tab */
          <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
            <View style={styles.formSection}>
              {loadingHistory ? (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color="#0D9488" />
                  <Text style={{ marginTop: 12, color: '#64748B' }}>Loading leave history...</Text>
                </View>
              ) : leaveHistory.length === 0 ? (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <MaterialCommunityIcons name="calendar-blank-outline" size={48} color="#CBD5E1" />
                  <Text style={{ marginTop: 12, color: '#94A3B8', fontSize: 15, fontWeight: '600' }}>No leave requests yet</Text>
                  <TouchableOpacity
                    style={{ marginTop: 16, backgroundColor: '#0D9488', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 }}
                    onPress={() => setActiveTab('request')}
                  >
                    <Text style={{ color: '#FFF', fontWeight: '700' }}>Request Leave</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                leaveHistory.map((leave, idx) => {
                  const badge = getStatusBadge(leave.status);
                  return (
                    <View key={leave.request_id || idx} style={styles.historyCard}>
                      {/* Status badge */}
                      <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                        <MaterialCommunityIcons name={badge.icon} size={14} color={badge.text} />
                        <Text style={[styles.statusText, { color: badge.text }]}>{badge.label}</Text>
                      </View>

                      {/* Dates */}
                      <View style={styles.historyDates}>
                        <View style={styles.historyDateCol}>
                          <Text style={styles.historyDateLabel}>From</Text>
                          <Text style={styles.historyDateValue}>{formatDate(leave.start_date)}</Text>
                        </View>
                        <MaterialCommunityIcons name="arrow-right" size={18} color="#CBD5E1" />
                        <View style={styles.historyDateCol}>
                          <Text style={styles.historyDateLabel}>To</Text>
                          <Text style={styles.historyDateValue}>{formatDate(leave.end_date)}</Text>
                        </View>
                        <View style={[styles.daysBadge]}>
                          <Text style={styles.daysText}>{leave.number_of_days || '—'}d</Text>
                        </View>
                      </View>

                      {/* Reason */}
                      <Text style={styles.historyReason} numberOfLines={2}>{leave.reason}</Text>

                      {/* Review info */}
                      {leave.reviewed_by && (
                        <View style={styles.reviewInfo}>
                          <MaterialCommunityIcons name="account-check" size={14} color="#64748B" />
                          <Text style={styles.reviewText}>
                            Reviewed by {leave.reviewed_by}
                            {leave.review_date ? ` on ${formatDate(leave.review_date)}` : ''}
                          </Text>
                        </View>
                      )}

                      {/* Requested date */}
                      <Text style={styles.requestedAt}>
                        Requested {leave.request_date ? formatDate(leave.request_date) : '—'}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </ScrollView>
        )}

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F0FDFA' },
  scrollContainer: { paddingBottom: 40 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#CCFBF1'
  },
  closeBtn: { padding: 8, backgroundColor: '#CCFBF1', borderRadius: 12 },
  headerTitle: { fontSize: 19, fontWeight: '800', color: '#134E4A' },

  // Tabs
  tabRow: {
    flexDirection: 'row', backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 8,
    gap: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 12, gap: 6, backgroundColor: '#F8FAFC',
  },
  tabActive: {
    backgroundColor: '#CCFBF1', borderWidth: 1.5, borderColor: '#5EEAD4',
  },
  tabText: { fontSize: 14, fontWeight: '600', color: '#9CA3AF' },
  tabTextActive: { color: '#0D9488' },
  badge: {
    backgroundColor: '#F59E0B', borderRadius: 10, width: 20, height: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },

  formSection: { padding: 20 },

  banner: {
    flexDirection: 'row', backgroundColor: '#CCFBF1', padding: 14, borderRadius: 12, marginBottom: 20,
    alignItems: 'flex-start', gap: 10,
  },
  bannerText: { flex: 1, color: '#0F766E', fontSize: 13, lineHeight: 20 },

  label: { fontSize: 14, fontWeight: '700', color: '#115E59', marginBottom: 8, marginTop: 4 },

  dateButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#99F6E4', borderRadius: 14, padding: 14, marginBottom: 16, gap: 12,
  },
  dateText: { flex: 1, fontSize: 16, fontWeight: '600', color: '#0F172A' },

  durationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: '#F5F3FF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginBottom: 20,
    borderWidth: 1, borderColor: '#E9D5FF',
  },
  durationText: { fontSize: 13, fontWeight: '700', color: '#7C3AED' },

  inputWrapper: {
    flexDirection: 'row', backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#99F6E4', borderRadius: 14, marginBottom: 16, paddingHorizontal: 14,
  },
  textArea: { flex: 1, height: 100, paddingTop: 14, color: '#0F172A', fontSize: 15 },

  footer: {
    padding: 16, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#CCFBF1'
  },
  submitBtn: {
    flexDirection: 'row', backgroundColor: '#0D9488', paddingVertical: 16,
    borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#0D9488', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4
  },
  submitBtnDisabled: { backgroundColor: '#9CA3AF', shadowOpacity: 0, elevation: 0 },
  submitBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // History
  historyCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#64748B', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginBottom: 12,
  },
  statusText: { fontSize: 12, fontWeight: '800' },

  historyDates: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
  },
  historyDateCol: {},
  historyDateLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '600', textTransform: 'uppercase' },
  historyDateValue: { fontSize: 14, fontWeight: '700', color: '#1E293B', marginTop: 2 },

  daysBadge: {
    backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginLeft: 'auto',
  },
  daysText: { fontSize: 13, fontWeight: '800', color: '#3B82F6' },

  historyReason: { fontSize: 13, color: '#475569', lineHeight: 19, marginBottom: 8 },

  reviewInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4,
  },
  reviewText: { fontSize: 11, color: '#64748B' },

  requestedAt: { fontSize: 11, color: '#94A3B8', marginTop: 4 },
});

export default LeaveRequestScreen;
