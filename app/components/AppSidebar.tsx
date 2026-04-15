"use client";

import { SidebarUser } from "@platform/auth";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Material Certs"
      logoSrc="/matl-cert/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Certificates",
          items: [
            { label: "Library", href: "/matl-cert/" },
            { label: "Pending", href: "/matl-cert/pending/" },
            { label: "Upload", href: "/matl-cert/upload/" },
          ],
        },
        {
          heading: "Traceability",
          items: [
            { label: "Search", href: "/matl-cert/search/" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
