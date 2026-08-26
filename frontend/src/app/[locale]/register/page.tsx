import { getTranslations } from "next-intl/server";
import AuthForm from "@/components/AuthForm";

export default async function RegisterPage() {
  await getTranslations("auth");
  return <AuthForm mode="register" />;
}
