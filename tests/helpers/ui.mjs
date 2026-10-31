import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { createFormControl } from 'react-hook-form';

// Presentation-only stand-ins for the existing deterministic hook driver.
// Real components and RHF hooks are exercised by Storybook and browser flows.
export const uiImports = {
  '@/lib/utils': { cn: (...values) => twMerge(clsx(values)) },
  '@/components/ui/text': { Text: 'Text' },
  '@/components/ui/button': { Button: 'Button' },
  '@/components/ui/icon': { Icon: 'Icon' },
  '@/components/ui/progress': { Progress: 'Progress' },
  '@/components/ui/separator': { Separator: 'Divider' },
  '@/components/ui/spinner': { Spinner: 'ActivityIndicator' },
  '@/components/ui/card': { Card: 'Card', CardContent: 'CardContent', CardHeader: 'CardHeader', CardTitle: 'CardTitle', CardDescription: 'CardDescription' },
  '@/components/ui/badge': { Badge: 'Badge' },
  '@/components/ui/text-field': { TextField: 'Input', FieldDescription: 'HelperText' },
  '@/components/ui/input': { Input: 'Input' },
  '@/components/ui/screen-header': { ScreenHeader: 'Header', HeaderTitle: 'Content' },
  '@/components/ui/feedback': { Feedback: 'Feedback' },
  '@/components/ui/portal': { PortalScope: 'PortalScope', Portal: 'Portal', ModalSurface: 'Modal', usePortalHost: () => undefined, useOverlayDismiss: () => {} },
  '@/components/ui/use-confirmation': { useConfirmation: () => ({ confirmation: null, confirmAction: () => {} }) },
  '@/components/ui/catalog-select': { CatalogSelect: 'CatalogSelect' },
  '@/components/ui/list-row': { ListRow: 'ListRow' },
  '@/components/ui/switch': { Switch: 'Switch' },
  '@/components/ui/toggle-group': { ToggleGroup: 'ToggleGroup', ToggleGroupItem: 'ToggleGroupItem' },
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
