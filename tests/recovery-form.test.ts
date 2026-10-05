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
  return React.Children.toArray(tree).flatMap((child) => {
    if (!React.isValidElement<Props>(child)) return [];
    return [child, ...elements(child.props.children)];
  });
}

function fixture(mode: "request" | "reset", offline = false) {
  const state: unknown[] = [];
  let cursor = 0;
  const resetCalls: { newPassword: string; token: string }[] = [];
  const requestCalls: { email: string; redirectTo: string }[] = [];
  const exports: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    react: {
      ...React,
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value: unknown) => { state[index] = value; }];
      },
      useEffect() {},
    },
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: (props: Props) => React.createElement("a", props) },
    "next/navigation": {
      useSearchParams: () => new URLSearchParams(mode === "reset" ? "token=reset-token" : ""),
      useRouter: () => ({ replace() {} }),
    },
    "@/presentation/hooks/use-translate": { useT: () => ({ t: (key: string) => key }) },
    "@/presentation/ui/password-field": { PasswordField: (props: Props) => React.createElement("input", props) },
    "@/infrastructure/auth/auth-client": { authClient: {
      async resetPassword(input: { newPassword: string; token: string }) {
        resetCalls.push(input);
        if (offline) throw new Error("Offline");
        return {};
      },
      async requestPasswordReset(input: { email: string; redirectTo: string }) {
        requestCalls.push(input);
        if (offline) throw new Error("Offline");
        return {};
      },
    } },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/presentation/features/auth/password-recovery-form.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, Error, window: { location: { origin: "https://coinsecret.example" } },
    require(name: string) {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const component = exports.PasswordRecoveryForm as (props: { mode: typeof mode }) => React.ReactNode;
  const render = () => { cursor = 0; return component({ mode }); };
  return {
    resetCalls, requestCalls,
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
  };
}

test("mismatched reset passwords show an error without an auth request", async () => {
  const f = fixture("reset");
  f.fill("billing.newPassword", "a long password");
  f.fill("auth.confirmPassword", "another password");
  await f.submit();
  assert.equal(f.resetCalls.length, 0);
  assert.equal(f.requestCalls.length, 0);
  assert.match(f.html(), /auth\.passwordMismatch/);
  assert.doesNotMatch(f.html(), /disabled=""/);
});

test("a matching reset preserves pasted password whitespace and shows confirmation", async () => {
  const f = fixture("reset");
  const password = "  same pasted password  ";
  f.fill("billing.newPassword", password);
  f.fill("auth.confirmPassword", password);
  await f.submit();
  assert.equal(f.resetCalls.length, 1);
  assert.equal(f.resetCalls[0].newPassword, password);
  assert.equal(f.resetCalls[0].token, "reset-token");
  assert.equal(f.requestCalls.length, 0);
  assert.match(f.html(), /billing\.passwordChanged/);
  assert.doesNotMatch(f.html(), /<form/);
});

test("network failures in both recovery modes show a message and enable retry", async () => {
  for (const mode of ["request", "reset"] as const) {
    const f = fixture(mode, true);
    if (mode === "request") f.fill("auth.email", "account@example.invalid");
    else {
      f.fill("billing.newPassword", "a long password");
      f.fill("auth.confirmPassword", "a long password");
    }
    await f.submit();
    assert.match(f.html(), /recovery\.requestFailed/);
    assert.doesNotMatch(f.html(), /disabled=""/);
    assert.equal(f.requestCalls.length + f.resetCalls.length, 1);
  }
});

test("email recovery sends one reset request with the reset page redirect", async () => {
  const f = fixture("request");
  f.fill("auth.email", "account@example.invalid");
  await f.submit();
  assert.equal(f.requestCalls.length, 1);
  assert.equal(f.requestCalls[0].email, "account@example.invalid");
  assert.equal(f.requestCalls[0].redirectTo, "https://coinsecret.example/reset-password");
  assert.equal(f.resetCalls.length, 0);
  assert.match(f.html(), /recovery\.linkSent/);
});
