'use client';
import { SiteLink as Link } from '../SiteLink';
import type { ReactNode } from 'react';
import { BookOpen, Plus, Settings2 } from 'lucide-react';
export function KnowledgeHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="knowledge-heading">
      <div>
        <Link className="knowledge-home-link" href="/knowledge">
          <BookOpen size={16} />
          Wiki 知识库
        </Link>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="knowledge-actions">{children}</div>
    </header>
  );
}
export function KnowledgeActions() {
  return (
    <>
      <Link className="knowledge-button" href="/knowledge/manage">
        <Settings2 size={16} />
        我的贡献与管理
      </Link>
      <Link className="knowledge-button knowledge-primary" href="/knowledge/new">
        <Plus size={16} />
        创建词条
      </Link>
    </>
  );
}
export function KnowledgeStatus({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  return loading ? (
    <p className="knowledge-status" role="status">
      正在加载…
    </p>
  ) : error ? (
    <div className="knowledge-notice knowledge-error" role="alert">
      {error}
      <button type="button" onClick={retry}>
        重新加载
      </button>
    </div>
  ) : null;
}
export function LoginNotice() {
  return (
    <div className="knowledge-notice">
      登录后可以编辑词条、保存私人草稿或提交纠错。
      <button type="button" onClick={() => window.dispatchEvent(new Event('umeet:login'))}>
        登录 / 注册
      </button>
    </div>
  );
}
export function formatTime(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
