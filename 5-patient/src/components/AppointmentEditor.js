import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiFetch, getResidentId } from '../apiHelper';
import { calendarDateKey, localDateKey } from '../calendar';
export default function AppointmentEditor({ appointment=null, onClose, onSaved }) {
  const [form,setForm]=useState({doctorName:appointment?.doctor_name||'',specialization:appointment?.specialization||'',date:calendarDateKey(appointment?.appointment_date)||localDateKey(),time:appointment?.appointment_time?.slice(0,5)||'',reason:appointment?.reason||''});
  const [saving,setSaving]=useState(false),[error,setError]=useState('');const busy=useRef(false),alive=useRef(true);
  useEffect(()=>()=>{alive.current=false;},[]);
  const save=async()=>{
    if(busy.current)return;
    if(!form.doctorName.trim()||calendarDateKey(form.date)!==form.date||form.date<localDateKey()||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(form.time)){setError('Enter the doctor, a valid date today or later, and time as HH:MM.');return;}
    busy.current=true;setSaving(true);setError('');
    try {const residentId=await getResidentId();const path=appointment?'/appointments/'+encodeURIComponent(appointment.appointment_id):'/appointments';
      const body=appointment?{status:'rescheduled',appointmentDate:form.date,appointmentTime:form.time}:{residentId,doctorName:form.doctorName.trim(),specialization:form.specialization.trim(),appointmentDate:form.date,appointmentTime:form.time,reason:form.reason.trim()};
      const response=await apiFetch(path,{method:appointment?'PUT':'POST',body:JSON.stringify(body)}),data=await response.json();
      if(!response.ok)throw Error(data.error||'Your appointment could not be saved.');
      if(alive.current){await onSaved();onClose();}
    }catch(e){if(alive.current)setError(e.message);}finally{busy.current=false;if(alive.current)setSaving(false);}
  };
  return <Modal visible transparent animationType="slide" onRequestClose={()=>{if(!saving)onClose();}}><View style={{flex:1,backgroundColor:'#0008',justifyContent:'center',padding:20}}><ScrollView contentContainerStyle={{backgroundColor:'white',padding:22,borderRadius:18}} keyboardShouldPersistTaps="handled">
    <Text style={{fontSize:22,fontWeight:'800'}}>{appointment?'Reschedule appointment':'Book appointment'}</Text>
    {[['doctorName','Doctor name'],['specialization','Specialization'],['date','Date (YYYY-MM-DD)'],['time','Time (HH:MM)'],['reason','Reason']].map(([key,label])=><View key={key} style={{marginTop:14}}><Text style={{marginBottom:6,fontWeight:'700'}}>{label}</Text><TextInput accessibilityLabel={label} editable={!saving&&(!appointment||['date','time'].includes(key))} maxLength={key==='reason'?5000:255} value={form[key]} autoCapitalize="none" onChangeText={value=>setForm(current=>({...current,[key]:value}))} style={{minHeight:48,borderWidth:1,borderColor:'#CBD5E1',borderRadius:10,padding:10}}/></View>)}
    {error?<Text accessibilityRole="alert" style={{color:'#991B1B',marginTop:12}}>{error}</Text>:null}
    <TouchableOpacity disabled={saving} onPress={save} style={{padding:16,borderRadius:12,backgroundColor:'#6D38FF',marginTop:18}}><Text style={{color:'white',fontWeight:'700',textAlign:'center'}}>{saving?'Saving…':'Save appointment'}</Text></TouchableOpacity>
    <TouchableOpacity disabled={saving} onPress={onClose}><Text style={{padding:16,textAlign:'center'}}>Cancel</Text></TouchableOpacity>
  </ScrollView></View></Modal>;
}

