import RequestError from '../components/RequestError';
import {useScreenRefresh} from '../useScreenRefresh';
import { localDateKey, parseCalendarDate } from '../calendar';
import { apiFetch } from '../apiHelper';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

const LeaveRequestScreen = ({ navigation }) => {
  const [startDate, setStartDate] = useState(new Date(Date.now() + 48 * 3600 * 1000));
  const [endDate, setEndDate] = useState(new Date(Date.now() + 72 * 3600 * 1000));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Leave history
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const submitLock = useRef(false);
  const initialDatesRef = useRef({ start: localDateKey(startDate), end: localDateKey(endDate) });
  const allowNavigationRef = useRef(false);
  const [activeTab, setActiveTab] = useState('request'); // 'request' | 'history'

  useEffect(() => navigation.addListener?.('beforeRemove', event => {
    const hasUnsavedChanges = Boolean(reason.trim())
      || localDateKey(startDate) !== initialDatesRef.current.start
      || localDateKey(endDate) !== initialDatesRef.current.end;
    if (!hasUnsavedChanges || allowNavigationRef.current) return;
    event.preventDefault();
    Alert.alert(
      'Discard Leave Request?',
      'Your leave request has not been submitted.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { allowNavigationRef.current = true; navigation.dispatch(event.data.action); } },
      ]
    );
  }), [navigation, reason, startDate, endDate]);
  const getCaretakerId = async () => {
    const { auth } = require('../firebase/config');
    const user = auth.currentUser;
    return user?.uid;
  };

  const fetchLeaveHistory = useCallback(async () => {
    setLoadError(null);
    try {
      const { auth } = require('../firebase/config');
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await apiFetch(`/caretakers/${user.uid}/leave-requests`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Leave history unavailable');
      if (res.ok) {
        const data = await res.json();
        setLeaveHistory(data);

        // If initial default dates overlap with any existing leave, automatically auto-adjust to next available date
        const s = localDateKey(startDate);
        const e = localDateKey(endDate);
        const collision = data.find(item => {
          if (item.status !== 'pending' && item.status !== 'approved') return false;
          const is = String(item.start_date).slice(0, 10);
          const ie = String(item.end_date).slice(0, 10);
          return is <= e && ie >= s;
        });
        if (collision) {
          let maxDateStr = localDateKey(new Date(Date.now() + 48 * 3600 * 1000));
          for (const item of data) {
            if (item.status === 'pending' || item.status === 'approved') {
              const itemEnd = String(item.end_date).slice(0, 10);
              if (itemEnd >= maxDateStr) maxDateStr = itemEnd;
            }
          }
          const nextStart = parseCalendarDate(maxDateStr);
          nextStart.setDate(nextStart.getDate() + 1);
          const nextEnd = new Date(nextStart.getTime() + 24 * 3600 * 1000);
          setStartDate(nextStart);
          setEndDate(nextEnd);
          initialDatesRef.current = { start: localDateKey(nextStart), end: localDateKey(nextEnd) };
        }
      }
    } catch (err) {
      setLoadError('Leave history could not be loaded. Check your connection and try again.');
      console.warn('[Leave] History fetch error:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  }, [startDate, endDate]);
  useScreenRefresh(navigation, fetchLeaveHistory);

  const getOverlappingLeave = useCallback((start, end) => {
    const s = localDateKey(start);
    const e = localDateKey(end);
    return leaveHistory.find(item => {
      if (item.status !== 'pending' && item.status !== 'approved') return false;
      const is = String(item.start_date).slice(0, 10);
      const ie = String(item.end_date).slice(0, 10);
      return is <= e && ie >= s;
    });
  }, [leaveHistory]);

  const selectNextAvailableDates = useCallback(() => {
    let maxDateStr = localDateKey(new Date(Date.now() + 48 * 3600 * 1000));
    for (const item of leaveHistory) {
      if (item.status === 'pending' || item.status === 'approved') {
        const itemEnd = String(item.end_date).slice(0, 10);
        if (itemEnd >= maxDateStr) maxDateStr = itemEnd;
      }
    }
    const nextStart = parseCalendarDate(maxDateStr);
    nextStart.setDate(nextStart.getDate() + 1);
    const nextEnd = new Date(nextStart.getTime() + 24 * 3600 * 1000);
    setStartDate(nextStart);
    setEndDate(nextEnd);
  }, [leaveHistory]);

  const handleWithdraw = useCallback((requestId) => {
    Alert.alert(
      'Cancel Leave Request',
      'Are you sure you want to withdraw this pending leave request?',
      [
        { text: 'Keep It', style: 'cancel' },
        {
          text: 'Yes, Withdraw',
          style: 'destructive',
          onPress: async () => {
            try {
              const { auth } = require('../firebase/config');
              const user = auth.currentUser;
              if (!user) return;
              const token = await user.getIdToken();
              const res = await apiFetch(`/caretakers/${user.uid}/leave-requests/${requestId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || 'Failed to cancel leave request');
              }
              Alert.alert('Request Withdrawn ✓', 'Your pending leave request has been cancelled.');
              fetchLeaveHistory();
            } catch (err) {
              Alert.alert('Withdrawal Failed', err.message || 'Could not cancel leave request.');
            }
          }
        }
      ]
    );
  }, [fetchLeaveHistory]);

  const formatDate = (date) => {
    const d = parseCalendarDate(date);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatDateISO = (date) => {
    return localDateKey(date);
  };

  const getDayCount = () => {
    const diff = parseCalendarDate(endDate) - parseCalendarDate(startDate);
    return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)) + 1);
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
    if (submitLock.current) return;
    if (!reason.trim()) {
      Alert.alert('Reason Required', 'Please provide a reason for your leave request.');
      return;
    }

    if (localDateKey(startDate) < localDateKey()) {
      Alert.alert('Invalid Start Date', 'Start date cannot be in the past.');
      return;
    }
    if (localDateKey(endDate) < localDateKey(startDate)) {
      Alert.alert('Invalid Date Range', 'End date cannot be before start date.');
      return;
    }

    const conflict = getOverlappingLeave(startDate, endDate);
    if (conflict) {
      Alert.alert(
        'Date Overlap Detected',
        `The selected dates overlap an existing ${conflict.status} leave (${String(conflict.start_date).slice(0, 10)} to ${String(conflict.end_date).slice(0, 10)}). Would you like to auto-select the next available dates?`,
        [
          { text: 'Auto-Fix Dates', onPress: () => selectNextAvailableDates() },
          { text: 'Change Manually', style: 'cancel' }
        ]
      );
      return;
    }

    submitLock.current=true;
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

      const res = await apiFetch(`/caretakers/${user.uid}/leave-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to submit leave request');
      }

      Alert.alert(
        'Request Submitted ✓',
        `Leave request for ${getDayCount()} day(s) has been sent to admin for approval.`,
        [{
          text: 'Great, Continue',
          onPress: () => {
            initialDatesRef.current = { start: localDateKey(startDate), end: localDateKey(endDate) };
            setReason('');
            setActiveTab('history');
            fetchLeaveHistory();
          }
        }]
      );
    } catch (error) {
      console.error(error);
      Alert.alert('Submission Failed', error.message || 'Could not submit leave request. Please try again later.');
    } finally {
      submitLock.current=false;
      setIsSubmitting(false);
    }
  };

  const conflictingLeave = getOverlappingLeave(startDate, endDate);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Dashboard')} style={styles.closeBtn}>
            <MaterialCommunityIcons name="arrow-left" size={22} color="#171459" />
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
            <MaterialCommunityIcons name="calendar-plus" size={18} color={activeTab === 'request' ? '#6D38FF' : '#9496AA'} />
            <Text style={[styles.tabText, activeTab === 'request' && styles.tabTextActive]}>New Request</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'history' && styles.tabActive]}
            onPress={() => setActiveTab('history')}
          >
            <MaterialCommunityIcons name="history" size={18} color={activeTab === 'history' ? '#6D38FF' : '#9496AA'} />
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>My History</Text>
            {leaveHistory.filter(l => l.status === 'pending').length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{leaveHistory.filter(l => l.status === 'pending').length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <RequestError message={loadError} onRetry={fetchLeaveHistory} />
        {activeTab === 'request' ? (
          <>
            <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
              <View style={styles.formSection}>
                <View style={styles.banner}>
                  <MaterialCommunityIcons name="information" size={20} color="#6D38FF" />
                  <Text style={styles.bannerText}>
                    Leave requests require at least 48 hours notice. Admin will review and approve your request.
                  </Text>
                </View>

                {/* Start Date */}
                <Text style={styles.label}>Start Date</Text>
                {Platform.OS === 'web' ? (
                  <View style={[styles.dateButton, { paddingVertical: 8, paddingHorizontal: 12 }]}>
                    <MaterialCommunityIcons name="calendar-start" size={22} color="#6D38FF" style={{ marginRight: 8 }} />
                    {React.createElement('input', {
                      type: 'date',
                      value: localDateKey(startDate),
                      min: localDateKey(),
                      onChange: (e) => {
                        const val = e.target.value;
                        if (val) {
                          const [y, m, d] = val.split('-').map(Number);
                          const newD = new Date(y, m - 1, d);
                          if (!isNaN(newD.getTime())) {
                            setStartDate(newD);
                            if (newD > endDate) setEndDate(newD);
                          }
                        }
                      },
                      style: {
                        flex: 1,
                        fontSize: 16,
                        color: '#171459',
                        outline: 'none',
                        border: 'none',
                        backgroundColor: 'transparent',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontWeight: '500',
                        width: '100%',
                      }
                    })}
                  </View>
                ) : (
                  <>
                    <TouchableOpacity style={styles.dateButton} onPress={() => setShowStartPicker(true)}>
                      <MaterialCommunityIcons name="calendar-start" size={22} color="#6D38FF" />
                      <Text style={styles.dateText}>{formatDate(startDate)}</Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color="#9496AA" />
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
                  </>
                )}

                {/* End Date */}
                <Text style={styles.label}>End Date</Text>
                {Platform.OS === 'web' ? (
                  <View style={[styles.dateButton, { paddingVertical: 8, paddingHorizontal: 12 }]}>
                    <MaterialCommunityIcons name="calendar-end" size={22} color="#6D38FF" style={{ marginRight: 8 }} />
                    {React.createElement('input', {
                      type: 'date',
                      value: localDateKey(endDate),
                      min: localDateKey(startDate),
                      onChange: (e) => {
                        const val = e.target.value;
                        if (val) {
                          const [y, m, d] = val.split('-').map(Number);
                          const newD = new Date(y, m - 1, d);
                          if (!isNaN(newD.getTime())) {
                            setEndDate(newD);
                          }
                        }
                      },
                      style: {
                        flex: 1,
                        fontSize: 16,
                        color: '#171459',
                        outline: 'none',
                        border: 'none',
                        backgroundColor: 'transparent',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontWeight: '500',
                        width: '100%',
                      }
                    })}
                  </View>
                ) : (
                  <>
                    <TouchableOpacity style={styles.dateButton} onPress={() => setShowEndPicker(true)}>
                      <MaterialCommunityIcons name="calendar-end" size={22} color="#6D38FF" />
                      <Text style={styles.dateText}>{formatDate(endDate)}</Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color="#9496AA" />
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
                  </>
                )}

                {/* Duration chip */}
                <View style={styles.durationChip}>
                  <MaterialCommunityIcons name="clock-outline" size={16} color="#7C3AED" />
                  <Text style={styles.durationText}>{getDayCount()} day{getDayCount() > 1 ? 's' : ''} leave</Text>
                </View>

                {/* Overlap Banner if any */}
                {conflictingLeave ? (
                  <View style={styles.overlapBanner}>
                    <MaterialCommunityIcons name="calendar-alert" size={24} color="#DC2626" />
                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                      <Text style={styles.overlapTitle}>
                        Dates overlap an existing {conflictingLeave.status} leave!
                      </Text>
                      <Text style={styles.overlapDesc}>
                        {String(conflictingLeave.start_date).slice(0, 10)} to {String(conflictingLeave.end_date).slice(0, 10)}
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.autoFixBtn} onPress={selectNextAvailableDates}>
                      <Text style={styles.autoFixBtnText}>Auto-Fix Dates</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Reason */}
                <Text style={styles.label}>Reason for Leave</Text>
                <View style={[styles.inputWrapper, { alignItems: 'flex-start' }]}>
                  <MaterialCommunityIcons name="text-box-outline" size={20} color="#9496AA" style={{ marginTop: 14, marginRight: 12 }} />
                  <TextInput
                    style={styles.textArea}
                    placeholder="Explain the reason for your leave request..."
                    placeholderTextColor="#9496AA"
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
              {conflictingLeave ? (
                <Text style={{ textAlign: 'center', fontSize: 12, color: '#DC2626', marginBottom: 8, fontWeight: '700' }}>
                  * Selected dates overlap an existing leave request. Tap "Auto-Fix Dates" above.
                </Text>
              ) : !reason.trim() ? (
                <Text style={{ textAlign: 'center', fontSize: 12, color: '#9496AA', marginBottom: 8 }}>
                  * Please enter a reason above to submit your leave request
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.submitBtn, (!reason.trim() || isSubmitting || !!conflictingLeave) && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={!reason.trim() || isSubmitting || !!conflictingLeave}
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
                  <ActivityIndicator size="large" color="#6D38FF" />
                  <Text style={{ marginTop: 12, color: '#73758E' }}>Loading leave history...</Text>
                </View>
              ) : leaveHistory.length === 0 ? (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <MaterialCommunityIcons name="calendar-blank-outline" size={48} color="#CBD5E1" />
                  <Text style={{ marginTop: 12, color: '#9496AA', fontSize: 15, fontWeight: '600' }}>{loadError ? 'Leave history unavailable. Please retry.' : 'No leave requests yet'}</Text>
                  <TouchableOpacity
                    style={{ marginTop: 16, backgroundColor: '#6D38FF', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 }}
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
                          <MaterialCommunityIcons name="account-check" size={14} color="#73758E" />
                          <Text style={styles.reviewText}>
                            Reviewed by {leave.reviewed_by}
                            {leave.review_date ? ` on ${formatDate(leave.review_date)}` : ''}
                          </Text>
                        </View>
                      )}

                      {/* Temporary replacement for approved requests */}
                      {leave.status === 'approved' && (leave.temporary_replacement_name || leave.temporary_replacement) && (
                        <View style={[styles.reviewInfo, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 4 }]}>
                          <MaterialCommunityIcons name="account-switch" size={15} color="#16A34A" />
                          <Text style={[styles.reviewText, { color: '#15803D', fontWeight: '600' }]}>
                            Temporary Replacement: {leave.temporary_replacement_name || leave.temporary_replacement}
                          </Text>
                        </View>
                      )}

                      {/* Requested date */}
                      <Text style={styles.requestedAt}>
                        Requested {leave.request_date ? formatDate(leave.request_date) : '—'}
                      </Text>

                      {/* Withdraw pending leave request button */}
                      {leave.status === 'pending' && (
                        <TouchableOpacity
                          style={styles.withdrawBtn}
                          onPress={() => handleWithdraw(leave.request_id)}
                        >
                          <MaterialCommunityIcons name="close-circle-outline" size={16} color="#DC2626" />
                          <Text style={styles.withdrawBtnText}>Cancel / Withdraw Request</Text>
                        </TouchableOpacity>
                      )}
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
    fontSize: 20, fontWeight: '800', color: '#171459', lineHeight: 28, letterSpacing: -0.6,
  },
  // Tabs
  tabRow: {
    flexDirection: 'row', marginHorizontal: 22, padding: 5, backgroundColor: '#EEEBFF', borderRadius: 21, gap: 5, marginBottom: 4,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 17, gap: 6, minHeight: 46,
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9496AA'
  },
  tabTextActive: {
    color: '#6D38FF'
  },
  badge: {
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  badgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800'
  },
  formSection: {
    margin: 22, padding: 20, backgroundColor: '#FFFFFF', borderRadius: 27, borderWidth: 1, borderColor: '#E6E1FB',
  },
  banner: {
    flexDirection: 'row', backgroundColor: '#EEEBFF', padding: 15, borderRadius: 19, marginBottom: 25, alignItems: 'flex-start', gap: 10,
  },
  bannerText: {
    flex: 1, color: '#73758E', fontSize: 11, lineHeight: 19,
  },
  label: {
    fontSize: 12, fontWeight: '700', color: '#171459', marginBottom: 10, marginTop: 5,
  },
  dateButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F6F5FF', borderWidth: 1, borderColor: '#E6E1FB', borderRadius: 18, padding: 17, marginBottom: 20, gap: 12,
  },
  dateText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#171459'
  },
  durationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E9D5FF'
  },
  durationText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#7C3AED'
  },
  inputWrapper: {
    flexDirection: 'row', backgroundColor: '#F6F5FF', borderWidth: 1, borderColor: '#E6E1FB', borderRadius: 19, marginBottom: 18, paddingHorizontal: 15,
  },
  textArea: {
    flex: 1,
    height: 100,
    paddingTop: 14,
    color: '#171459',
    fontSize: 15
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EEEBFF'
  },
  submitBtn: { flexDirection: 'row', backgroundColor: '#6D38FF', paddingVertical: 18, borderRadius: 21, alignItems: 'center', justifyContent: 'center', minHeight: 56, shadowColor: '#6D38FF', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.2, shadowRadius: 15, elevation: 3 },
  submitBtnDisabled: {
    backgroundColor: '#9496AA',
    shadowOpacity: 0,
    elevation: 0
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  // History
  historyCard: {
    backgroundColor: '#FFFFFF', borderRadius: 26, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#E6E1FB',
    shadowColor: '#171459', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginBottom: 12
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800'
  },
  historyDates: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10
  },
  historyDateCol: {},
  historyDateLabel: {
    fontSize: 10,
    color: '#9496AA',
    fontWeight: '600',
    textTransform: 'uppercase'
  },
  historyDateValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#171459',
    marginTop: 2
  },
  daysBadge: {
    backgroundColor: '#EEEBFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 'auto'
  },
  daysText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6D38FF'
  },
  historyReason: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 19,
    marginBottom: 8
  },
  reviewInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4
  },
  reviewText: {
    fontSize: 11,
    color: '#73758E'
  },
  requestedAt: {
    fontSize: 11,
    color: '#9496AA',
    marginTop: 4
  },
  leaveHero: { marginHorizontal: 22, marginBottom: 20, backgroundColor: '#6D38FF', borderRadius: 27, padding: 22, flexDirection: 'row', alignItems: 'center', gap: 17 },
  leaveHeroIcon: { width: 55, height: 65, borderRadius: 20, backgroundColor: '#3478FF', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-5deg' }] },
  leaveEyebrow: { fontSize: 7, fontWeight: '800', letterSpacing: 1, color: '#D8CCFF', marginBottom: 9 },
  leaveHeroTitle: { fontSize: 23, color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.6 },
  leaveHeroSub: { fontSize: 10, color: '#D8CCFF', lineHeight: 17, marginTop: 7 },
  overlapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FECACA',
    borderRadius: 16,
    padding: 12,
    marginBottom: 20,
  },
  overlapTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#991B1B',
  },
  overlapDesc: {
    fontSize: 11,
    color: '#B91C1C',
    marginTop: 2,
  },
  autoFixBtn: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  autoFixBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  withdrawBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 12,
    gap: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  withdrawBtnText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default LeaveRequestScreen;
