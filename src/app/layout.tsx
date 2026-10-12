import './globals.css'
import PwaRegister from '@/components/PwaRegister'
import {I18nProvider} from '@/lib/i18n'
import type {Metadata,Viewport} from 'next'
import {Sora,Inter,Noto_Sans_Ethiopic} from 'next/font/google'
const d=Sora({subsets:['latin'],weight:["600","700"],variable:'--font-display'})
const s=Inter({subsets:['latin'],variable:'--font-sans'})
const e=Noto_Sans_Ethiopic({subsets:['ethiopic'],variable:'--font-am'})
export const metadata:Metadata={title:'Game Zone Counter',description:'Live counters for game zones',manifest:'/manifest.webmanifest',icons:{apple:'/icon-192.png'}}
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#120D0C'}
export default function L({children}:{children:React.ReactNode}){return <html lang="en"><body className={`${d.variable} ${s.variable} ${e.variable} font-sans`}><I18nProvider>{children}</I18nProvider><PwaRegister/></body></html>}
