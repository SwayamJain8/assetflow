/** Mirrors the backend's Zod schemas — the shapes the API actually returns. */

export type Role = "admin" | "asset_manager" | "department_head" | "employee";

export type AssetStatus =
  | "available"
  | "allocated"
  | "reserved"
  | "under_maintenance"
  | "lost"
  | "retired"
  | "disposed";

export type Condition = "new" | "good" | "fair" | "poor" | "damaged";
export type Priority = "low" | "medium" | "high" | "critical";

export type MaintenanceStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "technician_assigned"
  | "in_progress"
  | "resolved";

export type BookingStatus = "upcoming" | "ongoing" | "completed" | "cancelled";
export type TransferStatus = "requested" | "approved" | "rejected" | "reallocated";
export type AuditItemStatus = "pending" | "verified" | "missing" | "damaged";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  organizationId: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  logoPath: string | null;
  theme: Record<string, string> | null;
};

export type Session = { token: string; user: User; organization: Organization };

export type Department = {
  id: string;
  name: string;
  headUserId: string | null;
  headName: string | null;
  parentDepartmentId: string | null;
  parentName: string | null;
  status: "active" | "inactive";
  memberCount: number;
  assetCount: number;
};

export type CustomField = { key: string; label: string; type: "text" | "number" | "date" };

export type Category = {
  id: string;
  name: string;
  description: string | null;
  customFields: CustomField[];
  assetCount: number;
};

export type Employee = {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  status: "active" | "inactive";
  assetsHeld: number;
  createdAt: string;
};

export type Asset = {
  id: string;
  assetTag: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  serialNumber: string | null;
  acquisitionDate: string | null;
  acquisitionCost: string | null;
  condition: Condition;
  location: string | null;
  photoPath: string | null;
  isBookable: boolean;
  status: AssetStatus;
  retirementDate: string | null;
  customValues: Record<string, string | number>;
  holderName: string | null;
  holderId: string | null;
  expectedReturnDate: string | null;
};

export type Resource = {
  id: string;
  assetTag: string;
  name: string;
  location: string | null;
  categoryName: string | null;
  status: AssetStatus;
};

export type TimelineEntry = {
  id: string;
  action: string;
  summary: string;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Allocation = {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  holderName: string | null;
  holderDepartmentName: string | null;
  allocatedByName: string | null;
  allocatedAt: string;
  expectedReturnDate: string | null;
  returnedAt: string | null;
  returnConditionNotes: string | null;
  isOverdue: boolean;
};

export type Transfer = {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  fromName: string | null;
  toName: string | null;
  reason: string | null;
  status: TransferStatus;
  requestedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type Booking = {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceTag: string;
  bookedById: string;
  bookedByName: string;
  startsAt: string;
  endsAt: string;
  purpose: string | null;
  status: BookingStatus;
  isMine: boolean;
};

export type MaintenanceRequest = {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  issueDescription: string;
  priority: Priority;
  status: MaintenanceStatus;
  photoPath: string | null;
  reportedByName: string | null;
  technicianId: string | null;
  technicianName: string | null;
  approvedByName: string | null;
  rejectionReason: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  approvedAt: string | null;
  resolvedAt: string | null;
};

export type AuditCycle = {
  id: string;
  name: string;
  scopeDepartmentId: string | null;
  scopeDepartmentName: string | null;
  scopeLocation: string | null;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
  auditors: { id: string; name: string }[];
  totalItems: number;
  checkedItems: number;
  discrepancies: number;
  createdAt: string;
  closedAt: string | null;
};

export type AuditItem = {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  expectedLocation: string | null;
  status: AuditItemStatus;
  notes: string | null;
  checkedByName: string | null;
  checkedAt: string | null;
};

export type DiscrepancyReport = {
  cycle: { id: string; name: string; status: string; startDate: string; endDate: string };
  summary: {
    total: number;
    verified: number;
    missing: number;
    damaged: number;
    unchecked: number;
    discrepancies: number;
  };
  discrepancies: AuditItem[];
};

export type Dashboard = {
  kpis: {
    available: number;
    allocated: number;
    underMaintenance: number;
    maintenanceToday: number;
    activeBookings: number;
    pendingTransfers: number;
    upcomingReturns: number;
    overdueReturns: number;
  };
  overdue: {
    allocationId: string;
    assetId: string;
    assetTag: string;
    assetName: string;
    holderName: string | null;
    expectedReturnDate: string;
    daysOverdue: number;
  }[];
  recentActivity: TimelineEntry[];
};

export type Reports = {
  utilizationByDepartment: {
    department: string;
    total: number;
    allocated: number;
    utilization: number;
  }[];
  maintenanceFrequency: {
    byMonth: { month: string; requests: number }[];
    byCategory: { category: string; requests: number }[];
  };
  mostUsed: { assetTag: string; name: string; allocations: number; bookings: number; uses: number }[];
  idle: { assetTag: string; name: string; idleDays: number; lastUsed: string | null }[];
  attentionNeeded: { assetTag: string; name: string; reason: string; days: number }[];
  bookingHeatmap: { dayOfWeek: number; hour: number; bookings: number }[];
  allocationSummary: {
    department: string;
    employees: number;
    assetsHeld: number;
    overdue: number;
  }[];
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export type ActivityEntry = TimelineEntry & { entityType: string; entityId: string | null };
