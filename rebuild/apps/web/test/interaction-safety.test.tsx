// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoAuthDialog, switchAccount } from '../src/components/DemoAuthDialog';
import { useUnsavedSettings, confirmSettingsLeave } from '../src/components/admin/use-unsaved-settings';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('interaction safety', () => {
  it('switching identifies the current account and removes the registration branch', async () => {
    await act(async () => root.render(<DemoAuthDialog currentAccount="Alice" />));
    await act(async () => window.dispatchEvent(new CustomEvent('umeet:login', { detail: { switchAccount: true } })));
    expect(host.querySelector('dialog')?.open).toBe(true);
    expect(host.querySelector('.auth-current-account')?.textContent).toContain('Alice');
    expect(host.textContent).toContain('登录并切换');
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === '注册账号')).toBe(false);
    expect(host.textContent).toContain('取消切换');
  });

  it('leaving unsaved settings can be canceled without navigating or changing the draft', async () => {
    function Settings() { useUnsavedSettings(true, false); return <><input defaultValue="unsaved" /><a href="/#/discover">离开</a></>; }
    await act(async () => root.render(<Settings />));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmSettingsLeave()).toBe(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    host.querySelector('a')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(host.querySelector('input')?.value).toBe('unsaved');
    confirm.mockReturnValue(true);
    expect(confirmSettingsLeave()).toBe(true);
  });

  it('saving in progress blocks leaving; clean settings remove the guard', async () => {
    function Settings({ dirty, busy }: { dirty: boolean; busy: boolean }) { useUnsavedSettings(dirty, busy); return null; }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => root.render(<Settings dirty={false} busy />));
    expect(confirmSettingsLeave()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => root.render(<Settings dirty={false} busy={false} />));
    expect(confirmSettingsLeave()).toBe(true);
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it('an acknowledged session change does not prompt after authentication already succeeded', async () => {
    function Settings() { useUnsavedSettings(true, false); return null; }
    await act(async () => root.render(<Settings />));
    window.dispatchEvent(new Event('umeet:session-changed'));
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
});
