"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/lib/auth";

// Placeholder landing page. Task 21 replaces it with each role's real dashboard.
export default function HomePage() {
  const { me } = useMe();
  if (!me) return null;
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Welcome, {me.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">Your role is {me.role}. You can access:</p>
        <div className="flex flex-wrap gap-1">
          {me.permissions.map((p) => (
            <Badge key={p} variant="secondary">
              {p}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
