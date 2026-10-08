import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

type Props = { children?: React.ReactNode; [key: string]: unknown };
function elements(tree: React.ReactNode): React.ReactElement<Props>[] {
  return React.Children.toArray(tree).flatMap((child) => !React.isValidElement<Props>(child) ? [] : [child, ...elements(child.props.children)]);
}

function fixture(mode: "request" | "reset" = "request", failure?: "request" | "reset") {
  const state: unknown[] = [];
  const resetCalls: { email: string; password: string; otp: string }[] = [];
  const requestCalls: { email: string }[] = [];
  const redirects: string[] = [];
  let cursor = 0;
  let notified = 0;
  const exports: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    react: {
      ...React,
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value: unknown) => { state[index] = value; }];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = { current: initial };
        return state[index];
      },
      useEffect() {},
    },
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: (props: Props) => React.createElement("a", props) },
    "next/navigation": { useRouter: () => ({ replace(path: string) { redirects.push(path); } }) },
    "@/presentation/hooks/use-translate": { useT: () => ({ t: (key: string) => key }) },
    "@/presentation/ui/password-field": { PasswordField: (props: Props) => React.createElement("input", props) },
    "@/infrastructure/auth/auth-client": {
      notifyAuthStateChanged() { notified++; },
      authClient: { emailOtp: {
        async resetPassword(input: typeof resetCalls[number]) {
          resetCalls.push(input);
          if (failure === "reset") throw new Error("Offline");
          return {};
        },
        async requestPasswordReset(input: typeof requestCalls[number]) {
          requestCalls.push(input);
          if (failure === "request") throw new Error("Offline");
          return {};
        },
      } },
    },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/presentation/features/auth/password-recovery-form.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, Error,
    require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); },
  });
  const component = exports.PasswordRecoveryForm as (props: { mode: typeof mode }) => React.ReactNode;
  const render = () => { cursor = 0; return component({ mode }); };
  return {
    resetCalls, requestCalls, redirects, notified: () => notified,
    html: () => renderToStaticMarkup(render()),
    fill(label: string, value: string) {
      const field = elements(render()).find((element) => element.props["aria-label"] === label);
      assert.ok(field, `Missing field ${label}`);
      (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    },
    async submit() {
      const form = elements(render()).find((element) => element.type === "form");
      assert.ok(form, "Recovery form must be available before submission");
      await (form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
    },
    async resend() {
      const button = elements(render()).find((element) => element.type === "button" && element.props.type === "button");
      assert.ok(button);
      await (button.props.onClick as () => Promise<void>)();
    },
  };
}

async function requested(mode: "request" | "reset" = "request", failure?: "reset") {
  const f = fixture(mode, failure);
  f.fill("auth.email", " Account@Example.invalid ");
  await f.submit();
  return f;
}

test("one email request stays on the website and advances to a 6-digit reset form in both entry pages", async () => {
  for (const mode of ["request", "reset"] as const) {
    const f = await requested(mode);
    assert.equal(f.requestCalls.length, 1);
    assert.equal(JSON.stringify(f.requestCalls[0]), JSON.stringify({ email: "account@example.invalid" }));
    assert.equal(f.redirects.length, 0, "No email, OTP or redirect token is put into a URL");
    assert.equal(f.resetCalls.length, 0);
    assert.match(f.html(), /recovery\.linkSent/);
    assert.match(f.html(), /inputmode="numeric".*pattern="\[0-9\]\{6\}".*maxLength="6"/i);
    await f.resend();
    assert.equal(f.requestCalls.length, 1, "Resend cooldown prevents a second email");
  }
});

test("simultaneous double submit sends only one reset email", async () => {
  const f = fixture();
  f.fill("auth.email", "account@example.invalid");
  await Promise.all([f.submit(), f.submit()]);
  assert.equal(f.requestCalls.length, 1);
});

test("mismatched reset passwords and incomplete codes never reach auth", async () => {
  const f = await requested();
  f.fill("recovery.codePlaceholder", "123456");
  f.fill("billing.newPassword", "a long password");
  f.fill("auth.confirmPassword", "another password");
  await f.submit();
  assert.equal(f.resetCalls.length, 0);
  assert.match(f.html(), /auth\.passwordMismatch/);
  f.fill("auth.confirmPassword", "a long password");
  f.fill("recovery.codePlaceholder", "123");
  await f.submit();
  assert.equal(f.resetCalls.length, 0);
  assert.match(f.html(), /recovery\.badToken/);
});

test("matching reset preserves the pasted password, clears fields and requires explicit login", async () => {
  const f = await requested();
  const password = "  same pasted password  ";
  f.fill("recovery.codePlaceholder", "12-34-56");
  f.fill("billing.newPassword", password);
  f.fill("auth.confirmPassword", password);
  await f.submit();
  assert.equal(f.resetCalls.length, 1);
  assert.equal(JSON.stringify(f.resetCalls[0]), JSON.stringify({ email: "account@example.invalid", otp: "123456", password }));
  assert.equal(f.notified(), 1);
  assert.equal(f.redirects.length, 0, "Success first shows confirmation before the login countdown");
  assert.match(f.html(), /billing\.passwordChanged/);
  assert.doesNotMatch(f.html(), /<form|same pasted password|123456/);
});

test("network failures in each step allow retry", async () => {
  const request = fixture("request", "request");
  request.fill("auth.email", "account@example.invalid");
  await request.submit();
  assert.match(request.html(), /recovery\.requestFailed/);
  assert.doesNotMatch(request.html(), /disabled=""/);
  const reset = await requested("reset", "reset");
  reset.fill("recovery.codePlaceholder", "123456");
  reset.fill("billing.newPassword", "a long password");
  reset.fill("auth.confirmPassword", "a long password");
  await reset.submit();
  assert.match(reset.html(), /recovery\.requestFailed/);
  assert.equal(reset.notified(), 0);
  assert.match(reset.html(), /<form/);
});
