import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { createFormControl } from 'react-hook-form';

// Presentation-only stand-ins for the existing deterministic hook driver.
// Real components and RHF hooks are exercised by Storybook and browser flows.
export const uiImports = {
  '@/shared/ui/cn': { cn: (...values) => twMerge(clsx(values)) },
  '@/shared/ui/text': { Text: 'Text' },
  '@/shared/ui/button': { Button: 'Button' },
  '@/shared/ui/icon': { Icon: 'Icon' },
  '@/shared/ui/progress': { Progress: 'Progress' },
  '@/shared/ui/separator': { Separator: 'Divider' },
  '@/shared/ui/spinner': { Spinner: 'ActivityIndicator' },
  '@/shared/ui/card': { Card: 'Card', CardContent: 'CardContent', CardHeader: 'CardHeader', CardTitle: 'CardTitle', CardDescription: 'CardDescription' },
  '@/shared/ui/badge': { Badge: 'Badge' },
  '@/shared/ui/text-field': { TextField: 'Input', FieldDescription: 'HelperText' },
  '@/shared/ui/input': { Input: 'Input' },
  '@/shared/ui/screen-header': { ScreenHeader: 'Header', HeaderTitle: 'Content' },
  '@/shared/ui/feedback': { Feedback: 'Feedback' },
  '@/shared/ui/portal': { PortalScope: 'PortalScope', Portal: 'Portal', ModalSurface: 'Modal', usePortalHost: () => undefined, useOverlayDismiss: () => {} },
  '@/shared/ui/use-confirmation': { useConfirmation: () => ({ confirmation: null, confirmAction: () => {} }) },
  '@/shared/ui/catalog-select': { CatalogSelect: 'CatalogSelect' },
  '@/shared/ui/list-row': { ListRow: 'ListRow' },
  '@/shared/ui/switch': { Switch: 'Switch' },
  '@/shared/ui/toggle-group': { ToggleGroup: 'ToggleGroup', ToggleGroupItem: 'ToggleGroupItem' },
};

// Use RHF's real controller/validation engine without substituting React's
// dispatcher inside the provider hook driver. Browser tests cover DOM refs.
export function formImports(react) {
  return {
    useForm(options) {
      const [form] = react.useState(() => createFormControl(options));
      const [state, setState] = react.useState({ errors: {} });
      react.useEffect(() => form.subscribe({ formState: { values: true, errors: true, isSubmitting: true }, callback: (next) => setState({ ...next }) }), [form]);
      return { ...form, control: form, formState: state };
    },
    useWatch({ control, name }) { return control.getValues(name); },
    useController({ control, name }) {
      control.register(name);
      return { field: { name, value: control.getValues(name), onChange: (value) => control.setValue(name, value, { shouldDirty: true }), onBlur: () => {}, ref: () => {} }, fieldState: control.getFieldState(name) };
    },
    useFieldArray({ control, name }) {
      const ids = react.useRef([]);
      const values = control.getValues(name);
      const fields = values.map((value, index) => ({ ...value, id: ids.current[index] ?? (ids.current[index] = String(index)) }));
      return { fields, append: (value) => control.setValue(name, [...values, value]), remove: (index) => { ids.current.splice(index, 1); control.setValue(name, values.filter((_, row) => row !== index)); } };
    },
  };
}

export function textContent(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return node?.props ? textContent(node.props.children) : '';
}
