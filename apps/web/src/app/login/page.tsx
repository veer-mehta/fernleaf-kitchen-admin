"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/form-field";
import { ApiRequestError, apiPost } from "@/lib/api";
import { ME_KEY, fetchMe } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => apiPost("/auth/login", { email, password }),
    onSuccess: async () => {
      // Put the fresh "me" in the cache BEFORE navigating. The cache still holds "not signed in"
      // from before login, and the panel would bounce straight back to /login if it saw that.
      await queryClient.fetchQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 0 });
      router.push("/");
    },
  });

  const error = login.error instanceof ApiRequestError ? login.error : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Fernleaf Kitchen Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            <FormField
              name="email"
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              errors={error?.fields}
            />
            <FormField
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              errors={error?.fields}
            />
            {/* Errors without a field (wrong password) show here. */}
            {error && !error.fields && <p className="text-sm text-destructive">{error.message}</p>}
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
