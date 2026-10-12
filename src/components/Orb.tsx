'use client'
import {useEffect,useRef} from 'react'
export default function Orb(){const r=useRef<HTMLDivElement>(null)
useEffect(()=>{let stop=false,raf=0;const el=r.current;if(!el||matchMedia('(prefers-reduced-motion: reduce)').matches)return
import('three').then(T=>{if(stop)return;const w=el.clientWidth,h=el.clientHeight,sc=new T.Scene(),cam=new T.PerspectiveCamera(45,w/h,.1,50);cam.position.z=4
const ren=new T.WebGLRenderer({alpha:true,antialias:true});ren.setSize(w,h);ren.setPixelRatio(Math.min(devicePixelRatio,2));el.appendChild(ren.domElement)
const m=new T.Mesh(new T.IcosahedronGeometry(1.3,2),new T.MeshBasicMaterial({color:0xE03A52,wireframe:true,transparent:true,opacity:.7}));sc.add(m)
const loop=()=>{m.rotation.y+=.004;m.rotation.x+=.002;ren.render(sc,cam);raf=requestAnimationFrame(loop)};loop()})
return()=>{stop=true;cancelAnimationFrame(raf);el.innerHTML=''}},[])
return <div ref={r} aria-hidden className="h-56 w-full"/>}
