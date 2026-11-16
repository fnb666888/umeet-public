'use client';
import { useState } from 'react';
import type {
  KnowledgeRoute,
  KnowledgeRouteInput,
  KnowledgeCapabilities,
} from '../../../../../packages/contracts/src/knowledge';
import { PagePicker, PageTitle } from './PagePicker';
import { knowledge, failureMessage } from './knowledge-client';
export function RouteEditor({
  communityId,
  cap,
  route,
  onSaved,
  onCancel,
}: {
  communityId: string;
  cap: KnowledgeCapabilities;
  route?: KnowledgeRoute;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<KnowledgeRouteInput>({
      ...(route ? { id: route.id } : {}),
      expectedVersion: route?.version ?? 0,
      title: route?.title ?? '',
      goal: route?.goal ?? '',
      steps:
        route?.steps.map(({ id, pageId, goal, intro, position }) => ({
          id,
          pageId,
          goal,
          intro,
          position,
        })) ?? [],
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  function move(index: number, delta: number) {
    const steps = [...value.steps],
      target = index + delta;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target]!, steps[index]!];
    setValue((v) => ({ ...v, steps: steps.map((s, position) => ({ ...s, position })) }));
  }
  return (
    <form
      className="knowledge-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          await knowledge(
            'communities/' + communityId + (cap.canOrganizeCommunity ? '/routes' : '/suggestions'),
            {
              method: 'POST',
              accountId: cap.accountId!,
              body: cap.canOrganizeCommunity ? value : { kind: 'route', change: value },
            },
          );
          onSaved();
        } catch (e) {
          setError(failureMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="knowledge-compose-fields" disabled={busy}>
        <section className="knowledge-form-section">
          <h2>{route ? '调整学习路线' : '创建学习路线'}</h2>
          <label>
            路线名称
            <input
              aria-label="路线名称"
              value={value.title}
              onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))}
              required
              maxLength={160}
            />
          </label>
          <label>
            整体学习目标
            <textarea
              aria-label="整体学习目标"
              value={value.goal}
              onChange={(e) => setValue((v) => ({ ...v, goal: e.target.value }))}
              required
              maxLength={4000}
              rows={3}
            />
          </label>
        </section>
        <section className="knowledge-form-section">
          <h2>阅读步骤</h2>
          <p className="knowledge-help">每一步引用一篇共享词条，正文始终跟随最新发布版。</p>
          {value.steps.map((step, i) => (
            <div className="knowledge-route-step-edit" key={step.id}>
              <div className="knowledge-row">
                <strong className="knowledge-grow">
                  {i + 1}. <PageTitle id={step.pageId} />
                </strong>
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)}>
                  上移
                </button>
                <button
                  type="button"
                  disabled={i === value.steps.length - 1}
                  onClick={() => move(i, 1)}
                >
                  下移
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setValue((v) => ({
                      ...v,
                      steps: v.steps
                        .filter((s) => s.id !== step.id)
                        .map((s, position) => ({ ...s, position })),
                    }))
                  }
                >
                  移除步骤
                </button>
              </div>
              <label>
                本步学习目标
                <input
                  aria-label="本步学习目标"
                  value={step.goal}
                  maxLength={2000}
                  onChange={(e) =>
                    setValue((v) => ({
                      ...v,
                      steps: v.steps.map((s) =>
                        s.id === step.id ? { ...s, goal: e.target.value } : s,
                      ),
                    }))
                  }
                />
              </label>
              <label>
                阅读导引
                <textarea
                  aria-label="阅读导引"
                  rows={3}
                  value={step.intro}
                  maxLength={8000}
                  onChange={(e) =>
                    setValue((v) => ({
                      ...v,
                      steps: v.steps.map((s) =>
                        s.id === step.id ? { ...s, intro: e.target.value } : s,
                      ),
                    }))
                  }
                />
              </label>
            </div>
          ))}
          <PagePicker
            label="添加一个阅读步骤"
            onSelect={(p) =>
              setValue((v) => ({
                ...v,
                steps: [
                  ...v.steps,
                  {
                    id: crypto.randomUUID(),
                    pageId: p.id,
                    goal: '',
                    intro: '',
                    position: v.steps.length,
                  },
                ],
              }))
            }
          />
        </section>
        {error && (
          <p role="alert" className="knowledge-notice knowledge-error">
            {error}
          </p>
        )}
        <div className="knowledge-actions">
          <button
            type="button"
            className="knowledge-button"
            onClick={() => {
              if (window.confirm('确定取消尚未提交的路线调整？')) onCancel();
            }}
          >
            取消调整
          </button>
          <button
            className="knowledge-button knowledge-primary"
            disabled={busy || !value.steps.length}
          >
            {busy ? '正在提交…' : cap.canOrganizeCommunity ? '保存学习路线' : '提交路线建议'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
