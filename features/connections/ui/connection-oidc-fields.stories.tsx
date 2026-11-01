import type { Meta, StoryObj } from '@storybook/react-vite';

import { ConnectionOidcFields } from '@/features/connections/ui/connection-oidc-fields';
import { Colors } from '@/shared/ui/theme/theme';

const value = {
  enabled: true,
  issuer: 'https://login.example.com/realms/main',
  clientId: 'opencode-mobile',
  scopes: 'openid profile email offline_access',
  tokenHeader: 'X-Auth-Request-Access-Token',
  redirectUri: '',
};

const meta = {
  title: 'Connections/OpenID Connect',
  component: ConnectionOidcFields,
  args: {
    value,
    status: 'signed-out',
    defaultRedirectUri: 'opencodemobile://oidc-callback',
    disabled: false,
    palette: Colors.light,
    onChange: () => {},
    onSignIn: () => {},
  },
} satisfies Meta<typeof ConnectionOidcFields>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = { args: { value: { ...value, enabled: false } } };
export const SignedOut: Story = {};
export const SignedIn: Story = { args: { status: 'signed-in' } };
export const Expired: Story = { args: { status: 'expired', error: 'Sign in with OpenID Connect again to use this server.' } };
export const SigningIn: Story = { args: { status: 'signing-in' } };
export const Disabled: Story = { args: { disabled: true } };
