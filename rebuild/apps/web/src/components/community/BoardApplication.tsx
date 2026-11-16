'use client';
import type { FormEvent } from 'react';
import type { ApplicationData, Eligibility } from './CommunityApplications';
import { Icon } from './Icon';

type Props = {
  value: ApplicationData;
  onChange: (value: ApplicationData) => void;
  slug: string;
  onSlugChange: (value: string) => void;
  eligibility: Eligibility | null;
  error: string;
  busy: boolean;
  submitted: boolean;
  onSubmit: (event: FormEvent) => void;
  onRetry: () => void;
};

export function BoardApplication({ value, onChange, slug, onSlugChange, eligibility, error, busy, submitted, onSubmit, onRetry }: Props) {
  const update = (patch: Partial<ApplicationData>) => onChange({ ...value, ...patch });
  const rules = value.rules.map((rule) => rule.trim()).filter(Boolean);
  const rulesInvalid = rules.length > 6 || rules.some((rule) => rule.length > 120);
  return (
    <section className="governance-page board-application">
      <a className="back board-application-back" href="#/discover">← 返回发现</a>
      {submitted ? (
        <div className="board-application-success" role="status">
          <span className="board-application-success-icon"><Icon name="check" /></span>
          <h1>申请已提交</h1>
          <p>「{value.name}」的开设申请已送交管理员审核。</p>
          <a className="btn-primary" href="#/discover">返回发现</a>
        </div>
      ) : (
        <>
          <header className="board-application-header">
            <h1>申请开设板块</h1>
            <p>介绍你想建立的板块，提交后由管理员审核。</p>
          </header>
          <section className="board-eligibility" aria-labelledby="board-eligibility-title">
            <div className="board-eligibility-heading">
              <h2 id="board-eligibility-title">申请资格</h2>
              <span className={'board-eligibility-status' + (eligibility?.eligible ? ' is-ready' : '')}>
                {eligibility ? eligibility.eligible ? '已满足条件' : '暂未满足条件' : '检查中'}
              </span>
            </div>
            {eligibility ? (
              <>
                <div className="board-eligibility-metrics">
                  {[
                    { label: '注册时长', current: eligibility.registeredDays, required: eligibility.requiredDays, unit: '天' },
                    { label: '有效发帖', current: eligibility.validPosts, required: eligibility.requiredPosts, unit: '篇' },
                  ].map((item) => (
                    <div className="board-eligibility-metric" key={item.label}>
                      <div><span>{item.label}</span><span><b>{item.current}</b> / {item.required} {item.unit}</span></div>
                      <progress aria-label={item.label} value={item.required === 0 ? 1 : Math.min(item.current, item.required)} max={item.required || 1} />
                    </div>
                  ))}
                </div>
                {!eligibility.eligible && <p className="board-eligibility-note">{eligibility.blockReasons.join('，')}。满足条件后即可提交。</p>}
              </>
            ) : <p className="board-eligibility-note">正在检查账号的申请资格…</p>}
          </section>
          <form className="governance-form board-application-form" onSubmit={onSubmit}>
            <fieldset disabled={busy}>
              <legend>板块信息</legend>
              <p className="board-fieldset-note">让大家一眼了解这里聊什么。</p>
              <div className="board-application-basics">
                <label htmlFor="board-name">板块名称
                  <input id="board-name" required maxLength={40} placeholder="例如：星空观察" value={value.name} onChange={(event) => update({ name: event.target.value })} />
                </label>
                <div>
                  <label htmlFor="board-slug">板块标识
                    <input id="board-slug" required minLength={2} maxLength={80} pattern="[a-z][a-z0-9-]{1,79}" placeholder="例如：astronomy" aria-describedby="board-slug-help" value={slug} onChange={(event) => onSlugChange(event.target.value)} />
                  </label>
                  <small id="board-slug-help">用于板块链接，2–80 位小写字母、数字或连字符，以字母开头。</small>
                </div>
              </div>
              <label htmlFor="board-description">板块简介
                <textarea id="board-description" required rows={3} maxLength={160} placeholder="介绍板块的主题、适合谁参与，以及可以分享的内容。" value={value.description} onChange={(event) => update({ description: event.target.value })} />
              </label>
              <div className="board-field-counter">{value.description.length} / 160</div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>社区规则</legend>
              <p className="board-fieldset-note">写下大家共同遵守的约定。</p>
              <label className="sr-only" htmlFor="board-rules">基本规则，每行一条</label>
              <textarea id="board-rules" required rows={4} aria-describedby="board-rules-help" aria-invalid={rulesInvalid} placeholder={'例如：\n围绕观星主题交流，尊重不同观点\n分享照片时注明来源，保护他人隐私'} value={value.rules.join('\n')} onChange={(event) => update({ rules: event.target.value.split('\n') })} />
              <div className="board-field-help" id="board-rules-help">每行一条，最多 6 条，每条不超过 120 字。{rulesInvalid && <span role="alert"> 请调整规则的条数或长度。</span>}</div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>开设理由</legend>
              <p className="board-fieldset-note">帮助管理员了解开设这个板块的必要性。</p>
              <label className="sr-only" htmlFor="board-reason">开设理由</label>
              <textarea id="board-reason" required rows={5} maxLength={2000} placeholder="为什么需要这个板块？它与现有板块有什么区别？你希望吸引哪些同学参与？" value={value.reason} onChange={(event) => update({ reason: event.target.value })} />
              <div className="board-field-counter">{value.reason.length} / 2000</div>
            </fieldset>
            <footer className="board-application-footer">
              {error && <div className="board-application-error" role="alert">{error} {!eligibility && <button type="button" onClick={onRetry}>重新检查</button>}</div>}
              <div className="board-application-actions">
                <p>{eligibility?.eligible ? '请确认填写内容完整、清晰后提交。' : '可先填写资料，满足申请条件后再提交。'}</p>
                <button className="btn-primary" disabled={busy || !eligibility?.eligible || rulesInvalid}>{busy ? '正在提交…' : '提交申请'}</button>
              </div>
            </footer>
          </form>
        </>
      )}
    </section>
  );
}
