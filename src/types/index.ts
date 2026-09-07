export type UserRole = 'Citizen' | 'Student' | 'Mentor' | 'Admin'
export type ChallengeStatus = 'Under review' | 'Published' | 'In progress' | 'Implemented' | 'Rejected'
export type Priority = 'Low' | 'Medium' | 'High' | 'Critical'
export type SolutionStatus = 'Draft' | 'Mentor review' | 'Approved' | 'Changes requested'
export type PublicSignupRole = Exclude<UserRole, 'Admin'>

export interface AuthSession {
  accessToken: string
  refreshToken: string
  user: User
}

export interface VerificationDelivery {
  ok: true
  email: string
  verificationRequired: true
  delivery: 'development' | 'email'
  expiresInSeconds: number
  developmentCode?: string
}

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  avatarUrl?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface Challenge {
  id: string
  title: string
  description: string
  category: string
  location: string
  status: ChallengeStatus
  priority: Priority
  readiness: number
  teams: number
  owner: string
  ownerEmail?: string
  ownerId: string
  evidence: number
  createdAt: string
  updatedAt: string
  statusHistory?: Array<{ fromStatus: ChallengeStatus | null; toStatus: ChallengeStatus; reason?: string; changedBy: string; createdAt: string }>
}

export interface TeamMember {
  id: string
  name: string
  role: UserRole
  memberRole: 'Owner' | 'Member'
  joinedAt: string
}

export interface Team {
  id: string
  name: string
  challengeId: string
  challenge: string
  ownerId: string
  owner: string
  members: number
  status: 'Active' | 'Inactive'
  createdAt: string
  updatedAt: string
  memberList?: TeamMember[]
  solutions?: number
}

export interface SolutionReview {
  id: string
  decision: 'Approved' | 'Changes requested'
  feedback: string
  reviewerId: string
  reviewer: string
  createdAt: string
}

export interface Solution {
  id: string
  title: string
  description: string
  repositoryUrl?: string | null
  demoUrl?: string | null
  teamId: string
  team: string
  challengeId: string
  challenge: string
  createdBy: string
  status: SolutionStatus
  feedback?: string | null
  latestFeedback?: string | null
  creator?: string
  creatorEmail?: string
  reviewCount?: number
  submittedAt?: string | null
  reviewedAt?: string | null
  createdAt: string
  updatedAt: string
  reviews?: SolutionReview[]
}

export interface ProgressUpdate {
  id: string
  summary: string
  completionPercent: number
  blockers?: string | null
  milestoneDate?: string | null
  author: string
  createdAt: string
}

export interface Notification {
  id: string
  title: string
  body: string
  resourceType?: string | null
  resourceId?: string | null
  readAt?: string | null
  createdAt: string
}

export interface DashboardSummary {
  role: UserRole
  challenges: { total: number; critical: number; open: number }
  teams: { total: number; mine: number }
  solutions: { total: number; awaiting_review: number; mine: number }
  unreadNotifications: number
}

export interface AdminOverview {
  usersByRole: Array<{ role: UserRole; count: number }>
  challengesByStatus: Array<{ status: ChallengeStatus; count: number }>
  activeTeams: number
  solutionsByStatus: Array<{ status: SolutionStatus; count: number }>
  totalUsers?: number
  totalChallenges?: number
  totalSolutions?: number
  totalReviews?: number
  evidenceFiles?: number
  progressUpdates?: number
}

export interface AdminReview {
  id: string
  solutionId: string
  solution?: string
  decision: 'Approved' | 'Changes requested'
  feedback: string
  reviewerId: string
  reviewer: string
  reviewerEmail?: string
  teamId?: string
  challengeId?: string
  createdAt: string
}
