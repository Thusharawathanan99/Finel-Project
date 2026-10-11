import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

let globalAlertListener = null;

export const patchAlertPolyfill = () => {
  if (Platform.OS === 'web') {
    Alert.alert = (title, message, buttons, options) => {
      let type = 'info';
      const text = `${title || ''} ${message || ''}`.toLowerCase();
      if (
        text.includes('success') ||
        text.includes('submitted') ||
        text.includes('sent') ||
        text.includes('saved') ||
        text.includes('✓') ||
        text.includes('✅')
      ) {
        type = 'success';
      } else if (
        text.includes('error') ||
        text.includes('failed') ||
        text.includes('invalid') ||
        text.includes('could not')
      ) {
        type = 'error';
      } else if (
        text.includes('warning') ||
        text.includes('alert') ||
        text.includes('check') ||
        text.includes('notice') ||
        text.includes('required')
      ) {
        type = 'warning';
      }

      showProfessionalAlert({
        title: title || 'Notice',
        message: message || '',
        type,
        buttons:
          buttons && buttons.length > 0
            ? buttons
            : [{ text: 'OK', style: 'default' }],
      });
    };
  }
};

// Automatically activate polyfill on import
patchAlertPolyfill();

export const showProfessionalAlert = (options) => {
  if (globalAlertListener) {
    globalAlertListener(options);
  } else {
    console.warn('[ProfessionalAlert] Alert listener not mounted yet', options);
  }
};

/**
 * Global AlertProvider that renders the professional confirmation/alert modal.
 */
export const ProfessionalAlertProvider = ({ children }) => {
  const [alertConfig, setAlertConfig] = useState(null);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));

  useEffect(() => {
    globalAlertListener = (options) => {
      setAlertConfig(options);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
          easing: Easing.out(Easing.back(1.5)),
        }),
      ]).start();
    };

    return () => {
      globalAlertListener = null;
    };
  }, []);

  const closeAlert = (callback) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setAlertConfig(null);
      if (typeof callback === 'function') {
        callback();
      }
    });
  };

  const getTheme = (type = 'info') => {
    switch (type) {
      case 'success':
        return {
          icon: 'check-circle',
          iconColor: '#10B981',
          bgBadge: '#ECFDF5',
          borderColor: '#A7F3D0',
          primaryBtnBg: '#10B981',
        };
      case 'error':
        return {
          icon: 'alert-circle',
          iconColor: '#EF4444',
          bgBadge: '#FEF2F2',
          borderColor: '#FECACA',
          primaryBtnBg: '#EF4444',
        };
      case 'warning':
        return {
          icon: 'alert',
          iconColor: '#F59E0B',
          bgBadge: '#FFFBEB',
          borderColor: '#FDE68A',
          primaryBtnBg: '#F59E0B',
        };
      case 'info':
      default:
        return {
          icon: 'information',
          iconColor: '#6D38FF',
          bgBadge: '#F5F3FF',
          borderColor: '#DDD6FE',
          primaryBtnBg: '#6D38FF',
        };
    }
  };

  const theme = getTheme(alertConfig?.type);
  const buttons = alertConfig?.buttons && alertConfig.buttons.length > 0
    ? alertConfig.buttons
    : [{ text: 'OK', style: 'default' }];

  return (
    <>
      {children}
      {alertConfig ? (
        <Modal
          transparent
          visible={!!alertConfig}
          animationType="none"
          onRequestClose={() => closeAlert()}
        >
          <View style={styles.overlay}>
            <Animated.View
              style={[
                styles.modalCard,
                {
                  opacity: fadeAnim,
                  transform: [{ scale: scaleAnim }],
                },
              ]}
            >
              {/* Badge Icon */}
              <View
                style={[
                  styles.badgeContainer,
                  { backgroundColor: theme.bgBadge, borderColor: theme.borderColor },
                ]}
              >
                <MaterialCommunityIcons
                  name={theme.icon}
                  size={42}
                  color={theme.iconColor}
                />
              </View>

              {/* Title */}
              <Text style={styles.modalTitle}>{alertConfig.title}</Text>

              {/* Message */}
              {alertConfig.message ? (
                <Text style={styles.modalMessage}>{alertConfig.message}</Text>
              ) : null}

              {/* Action Buttons */}
              <View
                style={[
                  styles.buttonRow,
                  buttons.length > 2 && { flexDirection: 'column' },
                ]}
              >
                {buttons.map((btn, idx) => {
                  const isCancel = btn.style === 'cancel';
                  const isDestructive = btn.style === 'destructive';

                  return (
                    <TouchableOpacity
                      key={idx}
                      activeOpacity={0.85}
                      style={[
                        styles.button,
                        isCancel
                          ? styles.cancelButton
                          : isDestructive
                          ? styles.destructiveButton
                          : [styles.primaryButton, { backgroundColor: theme.primaryBtnBg }],
                        buttons.length > 1 && styles.multiButton,
                      ]}
                      onPress={() => closeAlert(btn.onPress)}
                    >
                      <Text
                        style={[
                          styles.buttonText,
                          isCancel
                            ? styles.cancelButtonText
                            : isDestructive
                            ? styles.destructiveButtonText
                            : styles.primaryButtonText,
                        ]}
                      >
                        {btn.text}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        </Modal>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    ...(Platform.OS === 'web'
      ? {
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }
      : {}),
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 26,
    alignItems: 'center',
    ...(Platform.OS === 'web'
      ? {
          boxShadow:
            '0 25px 50px -12px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(226, 232, 240, 0.8)',
        }
      : {
          elevation: 12,
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.25,
          shadowRadius: 24,
        }),
  },
  badgeContainer: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  modalMessage: {
    fontSize: 15,
    fontWeight: '400',
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 26,
    paddingHorizontal: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'center',
    gap: 12,
  },
  button: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 48,
  },
  multiButton: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: '#6D38FF',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 4px 12px rgba(109, 56, 255, 0.3)',
          cursor: 'pointer',
        }
      : {}),
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  cancelButton: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...(Platform.OS === 'web'
      ? {
          cursor: 'pointer',
        }
      : {}),
  },
  cancelButtonText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '600',
  },
  destructiveButton: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    ...(Platform.OS === 'web'
      ? {
          cursor: 'pointer',
        }
      : {}),
  },
  destructiveButtonText: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '700',
  },
});
