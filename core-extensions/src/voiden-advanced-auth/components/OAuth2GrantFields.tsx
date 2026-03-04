/**
 * Dynamic form fields that change based on the selected OAuth2 grant type.
 */
import React from "react";
import type { OAuth2Config, OAuth2GrantType } from "../lib/oauth2/types";

interface OAuth2GrantFieldsProps {
  config: OAuth2Config;
  onChange: (key: keyof OAuth2Config, value: string) => void;
  disabled?: boolean;
}

const inputClass =
  "w-full text-xs font-mono bg-bg text-text border border-stone-700/50 rounded px-2 py-1 focus:outline-none focus:border-accent transition-colors";

const labelClass = "block text-xs text-comment mb-0.5";

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  readOnly,
  type = "text",
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        className={`${inputClass}${readOnly ? " opacity-60 cursor-default" : ""}${disabled ? " opacity-50 cursor-not-allowed" : ""}`}
      />
    </div>
  );
}

/** Fields shown for Authorization Code flow */
function AuthCodeFields({
  config,
  onChange,
  disabled,
}: OAuth2GrantFieldsProps) {
  return (
    <>
      <Field
        label="Auth URL"
        value={config.authUrl}
        onChange={(v) => onChange("authUrl", v)}
        placeholder="https://provider.com/authorize"
        disabled={disabled}
      />
      <Field
        label="Token URL"
        value={config.tokenUrl}
        onChange={(v) => onChange("tokenUrl", v)}
        placeholder="https://provider.com/token"
        disabled={disabled}
      />
      <Field
        label="Client ID"
        value={config.clientId}
        onChange={(v) => onChange("clientId", v)}
        placeholder="{{CLIENT_ID}}"
        disabled={disabled}
      />
      <Field
        label="Client Secret"
        value={config.clientSecret}
        onChange={(v) => onChange("clientSecret", v)}
        placeholder="{{CLIENT_SECRET}}"
        disabled={disabled}
      />
      <Field
        label="Scope"
        value={config.scope}
        onChange={(v) => onChange("scope", v)}
        placeholder="openid profile email"
        disabled={disabled}
      />
      <Field
        label="Callback URL"
        value={config.callbackUrl}
        onChange={(v) => onChange("callbackUrl", v)}
        placeholder="http://127.0.0.1:9090/callback (auto if empty)"
        disabled={disabled}
      />
    </>
  );
}

/** Fields shown for Implicit flow */
function ImplicitFields({
  config,
  onChange,
  disabled,
}: OAuth2GrantFieldsProps) {
  return (
    <>
      <Field
        label="Auth URL"
        value={config.authUrl}
        onChange={(v) => onChange("authUrl", v)}
        placeholder="https://provider.com/authorize"
        disabled={disabled}
      />
      <Field
        label="Client ID"
        value={config.clientId}
        onChange={(v) => onChange("clientId", v)}
        placeholder="{{CLIENT_ID}}"
        disabled={disabled}
      />
      <Field
        label="Scope"
        value={config.scope}
        onChange={(v) => onChange("scope", v)}
        placeholder="openid profile email"
        disabled={disabled}
      />
      <Field
        label="Callback URL"
        value={config.callbackUrl}
        onChange={(v) => onChange("callbackUrl", v)}
        placeholder="http://127.0.0.1:9090/callback (auto if empty)"
        disabled={disabled}
      />
    </>
  );
}

/** Fields shown for Password grant */
function PasswordFields({
  config,
  onChange,
  disabled,
}: OAuth2GrantFieldsProps) {
  return (
    <>
      <Field
        label="Token URL"
        value={config.tokenUrl}
        onChange={(v) => onChange("tokenUrl", v)}
        placeholder="https://provider.com/token"
        disabled={disabled}
      />
      <Field
        label="Client ID"
        value={config.clientId}
        onChange={(v) => onChange("clientId", v)}
        placeholder="{{CLIENT_ID}}"
        disabled={disabled}
      />
      <Field
        label="Client Secret"
        value={config.clientSecret}
        onChange={(v) => onChange("clientSecret", v)}
        placeholder="{{CLIENT_SECRET}}"
        disabled={disabled}
      />
      <Field
        label="Username"
        value={config.username}
        onChange={(v) => onChange("username", v)}
        placeholder="user@example.com"
        disabled={disabled}
      />
      <Field
        label="Password"
        value={config.password}
        onChange={(v) => onChange("password", v)}
        placeholder="{{PASSWORD}}"
        disabled={disabled}
        type="password"
      />
      <Field
        label="Scope"
        value={config.scope}
        onChange={(v) => onChange("scope", v)}
        placeholder="openid profile"
        disabled={disabled}
      />
    </>
  );
}

/** Fields shown for Client Credentials grant */
function ClientCredentialsFields({
  config,
  onChange,
  disabled,
}: OAuth2GrantFieldsProps) {
  return (
    <>
      <Field
        label="Token URL"
        value={config.tokenUrl}
        onChange={(v) => onChange("tokenUrl", v)}
        placeholder="https://provider.com/token"
        disabled={disabled}
      />
      <Field
        label="Client ID"
        value={config.clientId}
        onChange={(v) => onChange("clientId", v)}
        placeholder="{{CLIENT_ID}}"
        disabled={disabled}
      />
      <Field
        label="Client Secret"
        value={config.clientSecret}
        onChange={(v) => onChange("clientSecret", v)}
        placeholder="{{CLIENT_SECRET}}"
        disabled={disabled}
      />
      <Field
        label="Scope"
        value={config.scope}
        onChange={(v) => onChange("scope", v)}
        placeholder="read write"
        disabled={disabled}
      />
    </>
  );
}

const FIELD_COMPONENTS: Record<OAuth2GrantType, React.FC<OAuth2GrantFieldsProps>> = {
  authorization_code: AuthCodeFields,
  implicit: ImplicitFields,
  password: PasswordFields,
  client_credentials: ClientCredentialsFields,
};

export const OAuth2GrantFields: React.FC<OAuth2GrantFieldsProps> = (props) => {
  const Component = FIELD_COMPONENTS[props.config.grantType];
  return Component ? <Component {...props} /> : null;
};
