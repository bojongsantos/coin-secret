export type UserRole = "USER" | "ADMIN";
export type SubscriptionPlan = "FREE" | "PREMIUM";

export interface CurrentUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  plan: SubscriptionPlan;
  emailVerified: boolean;
  accessExpiresAt?: string | null;
  accessSource?: string | null;
}
