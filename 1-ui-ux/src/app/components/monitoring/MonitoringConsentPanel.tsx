import { useCallback, useRef, useState } from 'react';
import { monitoringApi, ConsentLanguage, ConsentScope } from '../../services/monitoringApi';
import { useMonitoringFeed } from './useMonitoringFeed';

const copy = {
  en: { title: 'Monitoring consent', description: 'Camera frames are processed on the monitoring device for activity and safety observations. Raw video is not stored by this monitoring service. Emotion observations are estimates, not a diagnosis. Research participation is optional. You can withdraw each permission at any time; withdrawing camera or activity consent stops new camera activity events. Previous care and audit records remain under the retention policy.', scopes: { camera: 'Camera processing', activity: 'Activity and safety monitoring', emotion: 'Emotion observations', research: 'Research participation' }, confirmed: 'I have read this information and freely agree to this permission.', grant: 'Grant permission', withdraw: 'Withdraw permission', pause: 'Pause camera monitoring', active: 'Granted', inactive: 'No active permission' },
  ta: { title: 'கண்காணிப்பிற்கான சம்மதம்', description: 'செயல்பாடு மற்றும் பாதுகாப்பைக் கவனிக்க கேமரா படங்கள் கண்காணிப்பு சாதனத்தில் செயலாக்கப்படுகின்றன. இந்தச் சேவையில் மூல வீடியோ சேமிக்கப்படுவதில்லை. உணர்ச்சிக் கணிப்புகள் மருத்துவ நோயறிதல் அல்ல. ஆய்வில் பங்கேற்பது விருப்பமானது. எந்த அனுமதியையும் எப்போது வேண்டுமானாலும் திரும்பப் பெறலாம். கேமரா அல்லது செயல்பாட்டிற்கான அனுமதியைத் திரும்பப் பெற்றால் புதிய கேமரா செயல்பாட்டு நிகழ்வுகள் நிறுத்தப்படும். முந்தைய பராமரிப்பு மற்றும் தணிக்கைப் பதிவுகள் சேமிப்புக் கொள்கையின்படி இருக்கும்.', scopes: { camera: 'கேமரா செயலாக்கம்', activity: 'செயல்பாடு மற்றும் பாதுகாப்புக் கண்காணிப்பு', emotion: 'உணர்ச்சிக் கணிப்புகள்', research: 'ஆய்வில் பங்கேற்பு' }, confirmed: 'இந்தத் தகவலைப் படித்து, என் விருப்பத்துடன் இந்த அனுமதியை வழங்குகிறேன்.', grant: 'அனுமதி வழங்கு', withdraw: 'அனுமதியைத் திரும்பப் பெறு', pause: 'கேமரா கண்காணிப்பை நிறுத்து', active: 'அனுமதி உள்ளது', inactive: 'செயலில் அனுமதி இல்லை' },
  si: { title: 'නිරීක්ෂණය සඳහා කැමැත්ත', description: 'ක්‍රියාකාරකම් සහ ආරක්ෂාව නිරීක්ෂණය සඳහා කැමරා රූප නිරීක්ෂණ උපකරණයේ සකසනු ලැබේ. මෙම සේවාවේ මුල් වීඩියෝ ගබඩා නොකෙරේ. හැඟීම් ඇස්තමේන්තු වෛද්‍ය රෝග විනිශ්චයක් නොවේ. පර්යේෂණයට සහභාගී වීම ස්වේච්ඡාවෙන් සිදු වේ. ඕනෑම අවසරයක් ඕනෑම වේලාවක ඉවත් කළ හැක. කැමරා හෝ ක්‍රියාකාරකම් අවසරය ඉවත් කළ විට නව කැමරා ක්‍රියාකාරකම් සිදුවීම් නතර වේ. පෙර සත්කාර සහ විගණන වාර්තා රඳවා ගැනීමේ ප්‍රතිපත්තිය අනුව පවතී.', scopes: { camera: 'කැමරා සැකසීම', activity: 'ක්‍රියාකාරකම් සහ ආරක්ෂාව නිරීක්ෂණය', emotion: 'හැඟීම් නිරීක්ෂණ', research: 'පර්යේෂණයට සහභාගී වීම' }, confirmed: 'මෙම තොරතුරු කියවා මගේ කැමැත්තෙන් මෙම අවසරය ලබා දෙමි.', grant: 'අවසරය දෙන්න', withdraw: 'අවසරය ඉවත් කරන්න', pause: 'කැමරා නිරීක්ෂණය නවත්වන්න', active: 'අවසරය ලබා දී ඇත', inactive: 'ක්‍රියාකාරී අවසරයක් නැත' },
};
const scopes: ConsentScope[] = ['camera', 'activity', 'emotion', 'research'];
export function MonitoringConsentPanel({ residentId, staff = false }: { residentId: string; staff?: boolean }) {
  const [language, setLanguage] = useState<ConsentLanguage>('en');
  const [confirmed, setConfirmed] = useState(false);
  const [subjectRole, setSubjectRole] = useState<'resident' | 'guardian'>('resident');
  const [guardianName, setGuardianName] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const fetchRows = useCallback((signal: AbortSignal) => monitoringApi.consents(residentId, signal), [residentId]);
  const feed = useMonitoringFeed(fetchRows);
  const words = copy[language];
  const latest = (scope: ConsentScope) => feed.rows.filter(row => row.scope === scope).sort((a, b) => Date.parse(b.effective_at) - Date.parse(a.effective_at) || Number(b.consent_id) - Number(a.consent_id))[0];
  const change = async (selected: ConsentScope[], status: 'granted' | 'withdrawn') => {
    if (busy.current) return;
    if (status === 'granted' && (!confirmed || staff && !notes.trim() || staff && subjectRole === 'guardian' && !guardianName.trim())) {
      setActionError('Confirm the permission and provide the signed consent reference. For a guardian, also enter their name.'); return;
    }
    busy.current = true; setPending(true); setActionError(''); setMessage('');
    try {
      // Independent scopes may be withdrawn together; report any partial failure and reload saved state.
      const results = await Promise.allSettled(selected.map(scope => monitoringApi.saveConsent(residentId, { scope, status, language, subjectRole: staff ? subjectRole : 'resident', guardianName: staff && subjectRole === 'guardian' ? guardianName.trim() : undefined, notes: notes.trim() || undefined, confirmed: status === 'granted' ? confirmed : undefined })));
      const failed = results.filter(result => result.status === 'rejected');
      if (failed.length) throw new Error(`${results.length - failed.length} of ${results.length} permission changes saved. ${(failed[0] as PromiseRejectedResult).reason?.message || 'Please retry the failed changes.'}`);
      setMessage(status === 'granted' ? 'Permission saved.' : 'Permission withdrawn. New monitoring events requiring it are blocked.');
      setConfirmed(false);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Permission could not be saved.'); }
    finally { await feed.reload(); busy.current = false; setPending(false); }
  };
  return <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Monitoring permissions">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{words.title}</h3><label className="text-sm">Language <select aria-label="Consent language" className="ml-2 rounded border p-2" value={language} onChange={event => { setLanguage(event.target.value as ConsentLanguage); setConfirmed(false); }}><option value="en">English</option><option value="ta">தமிழ்</option><option value="si">සිංහල</option></select></label></div>
    <p className="text-sm text-slate-700" lang={language}>{words.description}</p>
    {feed.error && <p role="alert" className="text-sm text-red-800">{feed.error} <button onClick={() => void feed.reload()} className="underline">Retry</button></p>}
    {feed.loading && <p role="status" className="text-sm">Loading consent records…</p>}
    {staff && <div className="space-y-2 rounded-lg bg-slate-50 p-3"><p className="text-sm">Record the resident’s or guardian’s actual signed consent. Enter a document/reference number and date; an administrator cannot consent on their behalf.</p><label className="block text-sm">Consenting person <select className="ml-2 rounded border p-2" value={subjectRole} onChange={event => { setSubjectRole(event.target.value as 'resident' | 'guardian'); setConfirmed(false); }}><option value="resident">Resident</option><option value="guardian">Guardian</option></select></label>{subjectRole === 'guardian' && <label className="block text-sm">Guardian name<input className="mt-1 block w-full rounded border p-2" maxLength={255} value={guardianName} onChange={event => setGuardianName(event.target.value)} /></label>}<label className="block text-sm">Signed consent reference and date<textarea className="mt-1 block w-full rounded border p-2" maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></label></div>}
    <label className="flex items-start gap-2 text-sm" lang={language}><input type="checkbox" className="mt-1" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{staff ? 'I confirm the recorded resident/guardian consent covers the permission selected below.' : words.confirmed}</label>
    <div className="space-y-2">{scopes.map(scope => { const row = latest(scope); const granted = Boolean(row?.active); return <div key={scope} className="flex flex-wrap items-center gap-2 rounded-lg border p-3"><div className="flex-1 min-w-40"><p className="text-sm font-medium" lang={language}>{words.scopes[scope]}</p><p className={`text-xs ${granted ? 'text-green-800' : 'text-slate-600'}`}>{feed.updatedAt ? granted ? words.active : words.inactive : 'Permission status unavailable'}{row && ` · ${new Date(row.effective_at).toLocaleString()}`}</p></div><button type="button" disabled={pending || !feed.updatedAt || !confirmed || staff && !notes.trim()} onClick={() => void change([scope], 'granted')} className="rounded border border-teal-600 px-3 py-2 text-sm text-teal-800 disabled:opacity-50">{words.grant}</button><button type="button" disabled={pending} onClick={() => void change([scope], 'withdrawn')} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{words.withdraw}</button></div>; })}</div>
    <button type="button" disabled={pending} onClick={() => void change(['camera', 'activity'], 'withdrawn')} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? 'Saving…' : words.pause}</button>
    <p className="text-xs text-slate-600">Resuming requires a new explicit grant for camera and activity; previous permissions are not restored automatically.</p>
    {message && <p role="status" className="text-sm text-green-800">{message}</p>}{actionError && <p role="alert" className="text-sm text-red-800">{actionError}</p>}
  </section>;
}
