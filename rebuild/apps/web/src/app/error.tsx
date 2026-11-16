'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="panel empty-state"><h1>暂时无法加载内容</h1><p>可能是服务连接暂时中断，请稍后重试。</p><button className="primary" onClick={reset}>重新加载</button></section>;}
