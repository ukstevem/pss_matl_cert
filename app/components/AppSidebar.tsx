"use client";

import { SidebarUser } from "@platform/auth";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Material Certs"
      navSections={[
        {
          heading: "Certificates",
          items: [
            { label: "Library", href: "/matl-cert/" },
            { label: "Pending", href: "/matl-cert/pending/" },
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
