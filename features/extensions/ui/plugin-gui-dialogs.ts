import type { PluginGuiTheme } from '@/features/extensions/model/plugin-gui';

type ConfirmOptions = {
  title: string;
  description?: string;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
};
type PromptOptions = {
  title: string;
  description?: string;
  placeholder?: string;
  value?: string;
  secret?: boolean;
  submit?: string;
};
type SelectOptions = {
  title: string;
  placeholder?: string;
  current?: unknown;
  options: { title: string; value: unknown; description?: string; group?: string }[];
};
type ToastOptions = {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'loading';
  duration?: number;
  persistent?: boolean;
  actions?: { label: string; run(): void }[];
};

function button(theme: PluginGuiTheme, label: string, primary = false) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  Object.assign(element.style, {
    border: `1px solid ${primary ? theme.tint : theme.border}`,
    borderRadius: '8px',
    background: primary ? theme.tint : theme.surface,
    color: primary ? theme.background : theme.foreground,
    padding: '7px 12px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  });
  return element;
}

/** In-view dialogs and toasts, scoped to the plugin's shadow root. */
export function createOverlays(root: ShadowRoot, theme: PluginGuiTheme) {
  const layer = document.createElement('div');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.35)',
    zIndex: '2147483646',
    padding: '20px',
  });
  root.appendChild(layer);

  const toastLayer = document.createElement('div');
  Object.assign(toastLayer.style, {
    position: 'fixed',
    left: '12px',
    right: '12px',
    bottom: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });
  root.appendChild(toastLayer);

  let openModals = 0;

  const modal = (title: string, description: string | undefined, content: HTMLElement, actions: HTMLElement[]) => {
    return new Promise<boolean>((resolve) => {
      const card = document.createElement('div');
      Object.assign(card.style, {
        width: '100%',
        maxWidth: '420px',
        maxHeight: '80vh',
        overflow: 'auto',
        border: `1px solid ${theme.border}`,
        borderRadius: '14px',
        background: theme.surface,
        color: theme.foreground,
        padding: '16px',
        boxShadow: '0 18px 50px rgba(0,0,0,0.28)',
      });
      const heading = document.createElement('div');
      heading.textContent = title;
      Object.assign(heading.style, { fontSize: '16px', fontWeight: '700', marginBottom: '6px' });
      card.appendChild(heading);
      if (description) {
        const body = document.createElement('div');
        body.textContent = description;
        Object.assign(body.style, { opacity: '0.75', fontSize: '13px', lineHeight: '1.45', marginBottom: '12px' });
        card.appendChild(body);
      }
      card.appendChild(content);
      const footer = document.createElement('div');
      Object.assign(footer.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' });
      actions.forEach((action) => footer.appendChild(action));
      card.appendChild(footer);
      layer.replaceChildren(card);
      layer.style.display = 'flex';
      openModals += 1;

      const close = (value: boolean) => {
        openModals = Math.max(0, openModals - 1);
        if (openModals === 0) layer.style.display = 'none';
        resolve(value);
      };
      (card as HTMLElement & { __close?: (value: boolean) => void }).__close = close;
    });
  };

  return {
    dialogs: {
      active: () => openModals > 0,
      open: () => {
        throw new Error('ctx.dialogs.open is not available on mobile; use confirm, alert, prompt or select.');
      },
      async confirm(options: ConfirmOptions) {
        const content = document.createElement('div');
        const cancel = button(theme, options.cancel ?? 'Cancel');
        const confirm = button(theme, options.confirm ?? 'Confirm', true);
        const done = modal(options.title, options.description, content, [cancel, confirm]);
        const close = (value: boolean) => {
          const card = layer.firstElementChild as (HTMLElement & { __close?: (value: boolean) => void }) | null;
          card?.__close?.(value);
        };
        cancel.addEventListener('click', () => close(false), { once: true });
        confirm.addEventListener('click', () => close(true), { once: true });
        return done;
      },
      async alert(options: { title: string; description?: string; ok?: string }) {
        const content = document.createElement('div');
        const ok = button(theme, options.ok ?? 'OK', true);
        const done = modal(options.title, options.description, content, [ok]);
        ok.addEventListener('click', () => {
          const card = layer.firstElementChild as (HTMLElement & { __close?: (value: boolean) => void }) | null;
          card?.__close?.(true);
        }, { once: true });
        await done;
      },
      async prompt(options: PromptOptions) {
        const content = document.createElement('div');
        const input = document.createElement('input');
        input.type = options.secret ? 'password' : 'text';
        input.value = options.value ?? '';
        input.placeholder = options.placeholder ?? '';
        Object.assign(input.style, {
          width: '100%',
          border: `1px solid ${theme.border}`,
          borderRadius: '8px',
          background: theme.background,
          color: theme.foreground,
          padding: '8px 10px',
          fontSize: '14px',
        });
        content.appendChild(input);
        const cancel = button(theme, 'Cancel');
        const submit = button(theme, options.submit ?? 'OK', true);
        const done = modal(options.title, options.description, content, [cancel, submit]);
        let result: string | undefined;
        const finish = (value: string | undefined) => {
          result = value;
          const card = layer.firstElementChild as (HTMLElement & { __close?: (value: boolean) => void }) | null;
          card?.__close?.(Boolean(value));
        };
        cancel.addEventListener('click', () => finish(undefined), { once: true });
        submit.addEventListener('click', () => finish(input.value || undefined), { once: true });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') finish(input.value || undefined);
        });
        setTimeout(() => input.focus(), 0);
        await done;
        return result;
      },
      async select<T>(options: SelectOptions) {
        const content = document.createElement('div');
        Object.assign(content.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
        let selected: T | undefined;
        const list = document.createElement('div');
        Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '50vh', overflow: 'auto' });
        for (const option of options.options) {
          const row = document.createElement('button');
          row.type = 'button';
          Object.assign(row.style, {
            textAlign: 'left',
            border: `1px solid ${option.value === options.current ? theme.tint : theme.border}`,
            borderRadius: '8px',
            background: theme.background,
            color: theme.foreground,
            padding: '8px 10px',
            cursor: 'pointer',
          });
          const title = document.createElement('div');
          title.textContent = option.title;
          title.style.fontWeight = '600';
          row.appendChild(title);
          if (option.description) {
            const description = document.createElement('div');
            description.textContent = option.description;
            description.style.opacity = '0.7';
            description.style.fontSize = '12px';
            row.appendChild(description);
          }
          row.addEventListener('click', () => {
            selected = option.value as T;
            const card = layer.firstElementChild as (HTMLElement & { __close?: (value: boolean) => void }) | null;
            card?.__close?.(true);
          }, { once: true });
          list.appendChild(row);
        }
        content.appendChild(list);
        const cancel = button(theme, 'Cancel');
        const done = modal(options.title, options.placeholder, content, [cancel]);
        cancel.addEventListener('click', () => {
          const card = layer.firstElementChild as (HTMLElement & { __close?: (value: boolean) => void }) | null;
          card?.__close?.(false);
        }, { once: true });
        await done;
        return selected;
      },
    },
    toast: {
      show(options: ToastOptions) {
        const element = document.createElement('div');
        const tone = options.variant === 'error' ? theme.border : options.variant === 'success' ? theme.tint : theme.border;
        Object.assign(element.style, {
          pointerEvents: 'auto',
          border: `1px solid ${tone}`,
          borderRadius: '10px',
          background: theme.surface,
          color: theme.foreground,
          padding: '10px 12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        });
        const title = document.createElement('div');
        title.textContent = options.title;
        title.style.fontWeight = '600';
        element.appendChild(title);
        if (options.description) {
          const description = document.createElement('div');
          description.textContent = options.description;
          description.style.opacity = '0.75';
          description.style.fontSize = '12px';
          description.style.marginTop = '2px';
          element.appendChild(description);
        }
        const dismiss = () => element.remove();
        if (options.actions?.length) {
          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '6px';
          actions.style.marginTop = '8px';
          for (const action of options.actions) {
            const control = button(theme, action.label);
            control.addEventListener('click', () => {
              action.run();
              dismiss();
            }, { once: true });
            actions.appendChild(control);
          }
          element.appendChild(actions);
        }
        toastLayer.appendChild(element);
        if (!options.persistent) setTimeout(dismiss, options.duration ?? 5000);
        return { dismiss };
      },
    },
  };
}
