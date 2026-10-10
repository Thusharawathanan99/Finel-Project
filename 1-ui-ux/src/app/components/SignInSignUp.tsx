import { useEffect, useState } from 'react';
import { User } from '../models/User';
import { Eye, EyeOff, Heart, Loader, UserPlus, Shield } from 'lucide-react';
import {
  getPasswordValidationError,
  requestPasswordReset,
  signUp,
  signIn,
} from '../services/firebaseAuthService';
import { caretakersApi } from '../services/apiService';

interface SignInSignUpProps {
  onComplete: (user: User) => void | Promise<void>;
}

interface CaretakerOption {
  caretaker_id: string;
  name: string;
  specialization?: string;
}

export function SignInSignUp({ onComplete }: SignInSignUpProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [loadingCaretakers, setLoadingCaretakers] = useState(false);
  const [caretakers, setCaretakers] = useState<CaretakerOption[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    residentId: '',
    caretakerId: '',
  });

  useEffect(() => {
    if (mode !== 'signup') {
      return;
    }

    let mounted = true;
    const loadCaretakers = async () => {
      setLoadingCaretakers(true);
      try {
        const data = await caretakersApi.getAll();
        if (mounted) {
          setCaretakers(data || []);
        }
      } catch (err) {
        console.error('[SignUp] Failed to load caretakers:', err);
        if (mounted) {
          setError('Unable to load caretakers right now. Please try again.');
        }
      } finally {
        if (mounted) {
          setLoadingCaretakers(false);
        }
      }
    };

    loadCaretakers();

    return () => {
      mounted = false;
    };
  }, [mode]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      const appUser = await signIn(formData.email, formData.password);
      if (appUser.role !== 'admin') {
        throw new Error('Access denied: Admin credentials required. Patients and Caretakers must use the CareConnect Mobile Applications.');
      }
      const user: User = {
        userId: appUser.uid,
        name: appUser.name,
        email: appUser.email,
        role: appUser.role,
        residentId: appUser.residentId,
      };
      await onComplete(user);
    } catch (err: any) {
      console.error('[SignIn] Error:', err);
      const code = err?.code || '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Invalid email or password.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many failed attempts. Please try again later.');
      } else {
        setError(err.message || 'Sign in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setError('');
    setNotice('');
    setResettingPassword(true);
    try {
      await requestPasswordReset(formData.email);
      setNotice('If an account exists for that email, a password reset link has been sent.');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/too-many-requests') {
        setError('Too many reset attempts. Please try again later.');
      } else {
        setError(err?.message || 'Unable to send the reset email. Please try again.');
      }
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match!');
      return;
    }
    const passwordError = getPasswordValidationError(formData.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (!formData.caretakerId) {
      setError('Please select a caretaker.');
      return;
    }

    setLoading(true);

    try {
      const appUser = await signUp(
        formData.email,
        formData.password,
        formData.name,
        formData.caretakerId,
        formData.residentId || undefined
      );

      const user: User = {
        userId: appUser.uid,
        name: appUser.name,
        email: appUser.email,
        role: appUser.role,
        residentId: appUser.residentId,
      };
      await onComplete(user);
    } catch (err: any) {
      console.error('[SignUp] Error:', err);
      const code = err?.code || '';
      if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists.');
      } else if (code === 'auth/weak-password') {
        setError('Password is too weak. Use 8+ characters with uppercase, lowercase, and a number.');
      } else if (code === 'auth/invalid-email') {
        setError('Invalid email address.');
      } else {
        setError(err.message || 'Sign up failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="care-auth min-h-screen flex items-center justify-center p-4">
      <div className="care-auth-layout">
      <aside className="care-auth-story">
        <div className="care-brand"><span className="care-brand-mark"><Heart aria-hidden="true" /></span>CareConnect.</div>
        <span className="care-eyebrow">YOUR CARE, CONNECTED</span>
        <h1>A familiar place.<br /><span>A better care day.</span></h1>
        <p>Stay connected to your health, your team, and the moments that matter.</p>
        <div className="care-auth-art" aria-hidden="true"><img src="/careconnect-characters.png" alt="" /></div>
        <div className="care-auth-note">Patient · Caretaker · Administrator<br /><strong>One thoughtfully connected experience.</strong></div>
      </aside>
      <div className="w-full max-w-md care-auth-form">
        <div className="bg-white rounded-2xl shadow-xl p-6 care-auth-card">
          <div className="text-center mb-6">
            <div className="inline-flex p-3 bg-teal-50 rounded-2xl mb-3">
              <Heart className="w-8 h-8 text-teal-700" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">CareConnect Administration</h2>
            <p className="text-sm text-gray-600 mt-1">Facility Administrator Web Portal</p>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-5 p-1 bg-gray-100 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError('');
                setNotice('');
              }}
              className={`py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'signin' ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600'
              }`}
              disabled={loading}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError('');
                setNotice('');
              }}
              className={`py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'signup' ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600'
              }`}
              disabled={loading}
            >
              Patient Register
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
              {notice}
            </div>
          )}
          <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="care-name" className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  id="care-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                  disabled={loading}
                />
              </div>
            )}

            <div>
              <label htmlFor="care-email" className="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input
                id="care-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="you@example.com"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="care-password" className="block text-xs font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  id="care-password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-teal-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  disabled={loading}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={loading || resettingPassword}
                  className="mt-2 text-xs font-semibold text-teal-700 hover:text-teal-900 disabled:opacity-60"
                >
                  {resettingPassword ? 'Sending reset link...' : 'Forgot password?'}
                </button>
              )}
            </div>

            {mode === 'signup' && (
              <>
                <div>
                  <label htmlFor="care-confirmPassword" className="block text-xs font-medium text-gray-700 mb-1">Confirm Password</label>
                  <div className="relative">
                    <input
                      id="care-confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      placeholder="Confirm your password"
                      className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                      autoComplete="new-password"
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((visible) => !visible)}
                      className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-teal-700"
                      aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                      aria-pressed={showConfirmPassword}
                      disabled={loading}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Use 8+ characters with uppercase, lowercase, and a number.</p>
                </div>

                <div>
                  <label htmlFor="care-caretakerId" className="block text-xs font-medium text-gray-700 mb-1">Choose Caretaker</label>
                  <div className="relative">
                    <select
                      id="care-caretakerId"
                  value={formData.caretakerId}
                      onChange={(e) => setFormData({ ...formData, caretakerId: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
                      required
                      disabled={loading || loadingCaretakers || caretakers.length === 0}
                    >
                      <option value="">
                        {loadingCaretakers
                          ? 'Loading caretakers...'
                          : caretakers.length === 0
                            ? 'No caretakers available'
                            : 'Select a caretaker'}
                      </option>
                      {caretakers.map((caretaker) => (
                        <option key={caretaker.caretaker_id} value={caretaker.caretaker_id}>
                          {caretaker.name}
                          {caretaker.specialization ? ` (${caretaker.specialization})` : ''}
                        </option>
                      ))}
                    </select>
                    <UserPlus className="w-4 h-4 text-gray-400 absolute right-3 top-2.5 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    New Resident ID (optional)
                  </label>
                  <input
                    type="text"
                    value={formData.residentId}
                    onChange={(e) => setFormData({ ...formData, residentId: e.target.value })}
                    placeholder="Leave blank to auto-create"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    disabled={loading}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Choose a new ID or leave this blank to create one automatically. Ask an administrator to link an existing resident.
                  </p>
                </div>
              </>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || (mode === 'signup' && loadingCaretakers)}
                className="w-full py-3 bg-gradient-to-r from-teal-700 to-emerald-700 text-white rounded-lg font-semibold text-sm shadow-md active:scale-98 transition-transform disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    {mode === 'signin' ? 'Signing In...' : 'Creating Patient Account...'}
                  </>
                ) : (
                  mode === 'signin' ? 'Sign In' : 'Create Patient Account'
                )}
              </button>
            </div>
          </form>

          {mode === 'signin' && (
            <div className="mt-4 pt-4 border-t border-gray-100 text-center">
              <button
                type="button"
                onClick={() => onComplete({
                  userId: 'DEMO',
                  name: 'Facility Administrator',
                  email: 'admin@careconnect.com',
                  role: 'admin',
                })}
                className="w-full py-2.5 px-4 bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200 rounded-xl font-medium text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Shield className="w-4 h-4 text-teal-700" />
                Quick Launch: Facility Administrator Dashboard
              </button>
            </div>
          )}


        </div>
      </div>
      </div>
    </div>
  );
}
