import type { PluginGuiTheme } from '@/features/extensions/model/plugin-gui';

type UiProps = Record<string, any>;

function append(element: HTMLElement, child: unknown) {
  if (child === undefined || child === null || child === false || child === true) return;
  if (Array.isArray(child)) {
    child.forEach((item) => append(element, item));
    return;
  }
  if (typeof child === 'function') {
    append(element, child());
    return;
  }
  if (child instanceof Node) element.appendChild(child);
  else element.appendChild(document.createTextNode(String(child)));
}

function base(theme: PluginGuiTheme) {
  return {
    color: theme.foreground,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
  };
}

/** A small DOM UI kit for `ctx.ui`. It is intentionally not the native app kit. */
export function createUi(theme: PluginGuiTheme) {
  const button = (props: UiProps, iconOnly = false) => {
    const element = document.createElement('button');
    Object.assign(element.style, base(theme), {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      border: `1px solid ${theme.border}`,
      borderRadius: '8px',
      background: props.variant === 'contrast' ? theme.tint : theme.surface,
      color: props.variant === 'contrast' ? theme.background : theme.foreground,
      padding: iconOnly ? '4px 7px' : '5px 10px',
      cursor: props.disabled || props.busy ? 'default' : 'pointer',
      opacity: props.disabled || props.busy ? 0.55 : 1,
      fontWeight: '500',
    });
    element.type = props.type === 'submit' ? 'submit' : 'button';
    element.disabled = Boolean(props.disabled || props.busy);
    if (props.title) element.title = String(props.title);
    if (props.label) element.setAttribute('aria-label', String(props.label));
    if (typeof props.onClick === 'function') element.addEventListener('click', props.onClick);
    if (props.icon) append(element, String(props.icon));
    append(element, props.children);
    return element;
  };

  const Icon = (props: UiProps) => {
    const element = document.createElement('span');
    Object.assign(element.style, base(theme), { display: 'inline-flex', alignItems: 'center' });
    element.textContent = String(props.name ?? '•');
    return element;
  };

  return {
    Icon,
    Button: (props: UiProps) => button(props),
    IconButton: (props: UiProps) => button(props, true),
    Tooltip: (props: UiProps) => props.children as HTMLElement,
    Menu: (props: UiProps) => {
      const element = document.createElement('div');
      Object.assign(element.style, base(theme), {
        display: 'flex',
        flexDirection: 'column',
        minWidth: '160px',
        border: `1px solid ${theme.border}`,
        borderRadius: '8px',
        background: theme.surface,
        padding: '4px',
      });
      for (const item of Array.isArray(props.items) ? props.items : []) {
        if (item.type === 'separator') {
          const line = document.createElement('div');
          line.style.height = '1px';
          line.style.background = theme.border;
          line.style.margin = '4px 0';
          element.appendChild(line);
          continue;
        }
        if (item.type === 'group') {
          const label = document.createElement('div');
          label.textContent = String(item.label ?? '');
          label.style.padding = '4px 8px';
          label.style.opacity = '0.65';
          element.appendChild(label);
          for (const entry of item.items ?? []) {
            const row = button({ ...entry, children: entry.label, onClick: entry.onSelect });
            element.appendChild(row);
          }
          continue;
        }
        element.appendChild(button({ ...item, children: item.label, onClick: item.onSelect }));
      }
      return element;
    },
    Loader: (props: UiProps) => {
      const element = document.createElement('div');
      Object.assign(element.style, base(theme), { opacity: '0.7', padding: '8px' });
      element.textContent = props.label ? String(props.label) : 'Loading…';
      return element;
    },
    Dialog: (props: UiProps) => {
      const element = document.createElement('div');
      Object.assign(element.style, base(theme), {
        border: `1px solid ${theme.border}`,
        borderRadius: '12px',
        background: theme.surface,
        padding: '16px',
        maxWidth: '480px',
      });
      const title = document.createElement('div');
      title.textContent = String(props.title ?? '');
      title.style.fontWeight = '600';
      title.style.fontSize = '15px';
      title.style.marginBottom = '8px';
      element.appendChild(title);
      if (props.description) {
        const description = document.createElement('div');
        description.textContent = String(props.description);
        description.style.opacity = '0.7';
        description.style.marginBottom = '12px';
        element.appendChild(description);
      }
      append(element, props.children);
      if (props.footer) {
        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '8px';
        footer.style.marginTop = '12px';
        append(footer, props.footer);
        element.appendChild(footer);
      }
      return element;
    },
    Switch: (props: UiProps) => {
      const label = document.createElement('label');
      Object.assign(label.style, base(theme), { display: 'flex', alignItems: 'center', gap: '8px' });
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(props.checked);
      input.disabled = Boolean(props.disabled);
      input.addEventListener('change', () => props.onChange?.(input.checked));
      label.appendChild(input);
      append(label, props.label ?? props.children);
      return label;
    },
    TextInput: (props: UiProps) => {
      const wrapper = document.createElement('label');
      Object.assign(wrapper.style, base(theme), { display: 'flex', flexDirection: 'column', gap: '4px' });
      if (props.label) {
        const label = document.createElement('span');
        label.textContent = String(props.label);
        label.style.opacity = '0.7';
        wrapper.appendChild(label);
      }
      const input = document.createElement('input');
      Object.assign(input.style, {
        border: `1px solid ${theme.border}`,
        borderRadius: '8px',
        background: theme.background,
        color: theme.foreground,
        padding: '7px 9px',
        fontSize: '13px',
      });
      input.type = props.type ?? 'text';
      input.value = String(props.value ?? '');
      input.placeholder = String(props.placeholder ?? '');
      input.disabled = Boolean(props.disabled);
      if (props.autofocus) setTimeout(() => input.focus(), 0);
      input.addEventListener('input', () => props.onInput?.(input.value));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') props.onSubmit?.(input.value);
      });
      wrapper.appendChild(input);
      return wrapper;
    },
    Keybind: (props: UiProps) => {
      const element = document.createElement('kbd');
      Object.assign(element.style, base(theme), {
        border: `1px solid ${theme.border}`,
        borderRadius: '4px',
        padding: '1px 5px',
        fontFamily: 'monospace',
      });
      element.textContent = (Array.isArray(props.keys) ? props.keys : []).join('+');
      return element;
    },
    Markdown: (props: UiProps) => {
      const element = document.createElement('pre');
      Object.assign(element.style, base(theme), { whiteSpace: 'pre-wrap', margin: '0' });
      element.textContent = String(props.text ?? '');
      return element;
    },
    Code: (props: UiProps) => {
      const element = document.createElement('pre');
      Object.assign(element.style, base(theme), {
        whiteSpace: 'pre-wrap',
        margin: '0',
        padding: '8px',
        borderRadius: '8px',
        background: theme.background,
        border: `1px solid ${theme.border}`,
        fontFamily: 'monospace',
      });
      element.textContent = String(props.content ?? '');
      return element;
    },
  };
}
