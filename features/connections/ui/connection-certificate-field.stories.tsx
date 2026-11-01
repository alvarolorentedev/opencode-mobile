import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConnectionCertificateView } from '@/features/connections/ui/connection-certificate-view';

const certificate = {
  pem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  fingerprint: 'a'.repeat(64),
  subject: 'CN=OpenCode Internal CA, O=OpenCode',
  issuer: 'CN=OpenCode Internal CA, O=OpenCode',
  notBefore: '2026-01-01T00:00:00Z',
  notAfter: '2031-01-01T00:00:00Z',
  kind: 'ca' as const,
  count: 1,
};

const meta = {
  title: 'Connections/Certificate',
  component: ConnectionCertificateView,
  args: {
    disabled: false,
    busy: false,
    onImport: () => {},
    onRemove: () => {},
  },
} satisfies Meta<typeof ConnectionCertificateView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Imported: Story = { args: { certificate } };
export const SelfSigned: Story = { args: { certificate: { ...certificate, kind: 'self-signed' } } };
export const Error: Story = { args: { error: 'This is not a valid X.509 certificate.' } };
export const Disabled: Story = { args: { certificate, disabled: true } };
