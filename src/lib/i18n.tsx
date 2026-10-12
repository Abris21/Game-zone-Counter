'use client'
import {createContext,useContext,useEffect,useState} from 'react'
import {am} from './am'
let cur='en'
export const getLang=()=>cur
const Ctx=createContext({lang:'en',cal:'greg',setLang:(_l:string)=>{},setCal:(_c:string)=>{}})
export function I18nProvider({children}:{children:React.ReactNode}){const [lang,setL]=useState('en'),[cal,setC]=useState('greg')
useEffect(()=>{setL(localStorage.getItem('gz-lang')||'en');setC(localStorage.getItem('gz-cal')||'greg')},[])
cur=lang
return <Ctx.Provider value={{lang,cal,setLang:l=>{localStorage.setItem('gz-lang',l);setL(l)},setCal:c=>{localStorage.setItem('gz-cal',c);setC(c)}}}>{children}</Ctx.Provider>}
export const useI18n=()=>useContext(Ctx)
export const useT=()=>{const {lang}=useContext(Ctx);return (k:string)=>lang==='am'?(am[k]??k):k}
