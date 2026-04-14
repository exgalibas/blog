import type { Props } from "astro";
import IconMail from "@/assets/icons/IconMail.svg";
import IconGitHub from "@/assets/icons/IconGitHub.svg";
import IconBrandX from "@/assets/icons/IconBrandX.svg";
import IconTelegram from "@/assets/icons/IconTelegram.svg";
import IconWhatsapp from "@/assets/icons/IconWhatsapp.svg";
import { SITE } from "@/config";

interface Social {
  name: string;
  href: string;
  linkTitle: string;
  icon: (_props: Props) => Element;
}

export const SOCIALS: Social[] = [
  {
    name: "Mail",
    href: "mailto:exgalibas@gmail.com",
    linkTitle: `发送邮件给 ${SITE.title}`,
    icon: IconMail,
  },
] as const;

export const SHARE_LINKS: Social[] = [
  {
    name: "WhatsApp",
    href: "https://wa.me/?text=",
    linkTitle: "通过 WhatsApp 分享",
    icon: IconWhatsapp,
  },
  {
    name: "X",
    href: "https://x.com/intent/post?url=",
    linkTitle: "在 X 上分享",
    icon: IconBrandX,
  },
  {
    name: "Telegram",
    href: "https://t.me/share/url?url=",
    linkTitle: "通过 Telegram 分享",
    icon: IconTelegram,
  },
  {
    name: "Mail",
    href: "mailto:?subject=看看这篇文章&body=",
    linkTitle: "通过邮件分享",
    icon: IconMail,
  },
] as const;
