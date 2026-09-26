-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "DepartmentStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('MENU', 'ACTION', 'DATA');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('SELF', 'DEPT', 'DEPT_AND_SUB', 'DEPT_LIST', 'TENANT');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowNodeType" AS ENUM ('START', 'VOTE', 'TASK', 'ESCALATION', 'CONDITION', 'END');

-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('DRAFT', 'VOTING', 'APPROVED', 'REJECTED', 'ESCALATED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InstanceNodeStatus" AS ENUM ('PENDING', 'VOTING', 'PENDING_CONCLUSION', 'PASSED', 'REJECTED', 'TIMEOUT', 'ESCALATED', 'SKIPPED', 'DONE');

-- CreateEnum
CREATE TYPE "ConclusionMode" AS ENUM ('AUTO', 'MANUAL_CONFIRM', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "ConclusionStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SUBMITTED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "ConclusionDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "DeadlineMode" AS ENUM ('CALENDAR_DAY', 'WORKING_DAY');

-- CreateEnum
CREATE TYPE "VoterType" AS ENUM ('USER', 'ROLE', 'DEPARTMENT', 'VOTE_GROUP', 'DEPT_WORKNO', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "PassRule" AS ENUM ('ALL', 'MAJORITY', 'RATIO', 'WEIGHTED', 'AT_LEAST_N');

-- CreateEnum
CREATE TYPE "RejectRule" AS ENUM ('ANY_VETO', 'OPPOSE_OVER', 'NONE');

-- CreateEnum
CREATE TYPE "AbstainPolicy" AS ENUM ('COUNT_IN_DENOMINATOR', 'EXCLUDE_FROM_DENOMINATOR', 'AS_APPROVE', 'AS_REJECT');

-- CreateEnum
CREATE TYPE "TimeoutPolicy" AS ENUM ('REMIND_ONLY', 'AUTO_REJECT', 'ESCALATE', 'AUTO_APPROVE');

-- CreateEnum
CREATE TYPE "VoteVisibility" AS ENUM ('PUBLIC', 'RESULT_ONLY', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "VoteViewScope" AS ENUM ('DEPT_ONLY', 'TENANT');

-- CreateEnum
CREATE TYPE "VoteDecision" AS ENUM ('APPROVE', 'REJECT', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "RevotePolicy" AS ENUM ('NOT_ALLOWED', 'ONCE', 'UNLIMITED_BEFORE_CONCLUSION');

-- CreateEnum
CREATE TYPE "TiePolicy" AS ENUM ('ESCALATE', 'REJECT', 'CHAIRMAN_VOTE');

-- CreateEnum
CREATE TYPE "VoterStatus" AS ENUM ('PENDING', 'VOTED', 'TIMEOUT', 'DELEGATED', 'SKIPPED', 'ABSENT');

-- CreateEnum
CREATE TYPE "AbsenceSource" AS ENUM ('MANUAL', 'LEAVE_SYNC', 'DECLARED');

-- CreateEnum
CREATE TYPE "QuorumPolicy" AS ENUM ('MIN_POOL_RATIO', 'NONE', 'MIN_POOL_N');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING_ASSIGN', 'PENDING_ACCEPT', 'IN_PROGRESS', 'PENDING_ACCEPTANCE', 'DONE', 'OVERDUE', 'CANCELLED', 'BLOCKED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskAssigneeRole" AS ENUM ('OWNER', 'COLLABORATOR', 'WATCHER', 'ACCEPTOR');

-- CreateEnum
CREATE TYPE "AssigneeRuleType" AS ENUM ('MANUAL', 'ROLE', 'DEPARTMENT', 'VOTE_GROUP', 'DEPT_WORKNO', 'LOAD_BALANCE', 'GRAB');

-- CreateEnum
CREATE TYPE "TaskDependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START');

-- CreateEnum
CREATE TYPE "EscalationSourceType" AS ENUM ('VOTE', 'TASK', 'INSTANCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('PENDING', 'SUBMITTED', 'SIGNED', 'VOTING', 'PENDING_CONCLUSION', 'ADOPTED', 'RETURNED', 'UPGRADED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EscalationTrigger" AS ENUM ('MANUAL', 'TIMEOUT', 'TIE', 'REPEATED_REJECT', 'OVER_LIMIT', 'CROSS_DEPT_DISPUTE', 'INSUFFICIENT_PERMISSION', 'TASK_BLOCKED', 'TASK_OVERDUE', 'CONCLUSION_TIMEOUT', 'QUORUM_NOT_MET');

-- CreateEnum
CREATE TYPE "TargetDeptRule" AS ENUM ('DIRECT_PARENT', 'LEVEL_UP', 'SPECIFIC_DEPT', 'SKIP_TO_LEVEL', 'BY_RULE');

-- CreateEnum
CREATE TYPE "EscalationAction" AS ENUM ('SIGN', 'START_VOTE', 'CAST_VOTE', 'SUBMIT_CONCLUSION', 'CONTINUE', 'RETURN', 'REQUEST_MORE', 'UPGRADE', 'FINAL_APPROVE', 'FINAL_REJECT', 'CLOSE');

-- CreateEnum
CREATE TYPE "WriteBackAction" AS ENUM ('CONTINUE', 'RETURN', 'REQUEST_MORE', 'FINAL_APPROVE', 'FINAL_REJECT');

-- CreateEnum
CREATE TYPE "EscalationAcceptMode" AS ENUM ('AUTO', 'GRAB', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "WorkNoMissingPolicy" AS ENUM ('ESCALATE_UP', 'NOTIFY_ADMIN', 'BLOCK');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('VOTE_PENDING', 'VOTE_RESULT', 'CONCLUSION_PENDING', 'TASK_ASSIGNED', 'TASK_OVERDUE', 'ESCALATION_CREATED', 'ESCALATION_VOTING', 'ESCALATION_HANDLED', 'INSTANCE_FINISHED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "StorageDriver" AS ENUM ('local', 's3');

-- CreateTable
CREATE TABLE "tenants" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "allowCrossLevel" BOOLEAN NOT NULL DEFAULT false,
    "allowAutoApprove" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "email" VARCHAR(128) NOT NULL,
    "phone" VARCHAR(32),
    "avatar" VARCHAR(512),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "passwordHash" VARCHAR(255) NOT NULL,
    "lastLoginAt" TIMESTAMPTZ(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "parentId" INTEGER,
    "path" VARCHAR(512) NOT NULL,
    "level" INTEGER NOT NULL,
    "managerId" INTEGER,
    "code" VARCHAR(64),
    "workNo" VARCHAR(64),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_workno_members" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "receiveNotify" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_workno_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_departments" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "dataScopeDefault" "ScopeType" NOT NULL DEFAULT 'SELF',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "type" "PermissionType" NOT NULL DEFAULT 'ACTION',
    "module" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'SELF',
    "scopeId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_groups" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vote_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_group_members" (
    "groupId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "weight" DECIMAL(10,4) NOT NULL DEFAULT 1,

    CONSTRAINT "vote_group_members_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" INTEGER,
    "description" TEXT,
    "icon" VARCHAR(64),
    "formSchema" JSONB NOT NULL DEFAULT '{}',
    "deadlineMode" "DeadlineMode" NOT NULL DEFAULT 'CALENDAR_DAY',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "publishedAt" TIMESTAMPTZ(3),
    "publishedBy" INTEGER,
    "changelog" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_nodes" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "versionId" INTEGER NOT NULL,
    "type" "WorkflowNodeType" NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "order" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "layerIndex" INTEGER,
    "nodeKey" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_edges" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "versionId" INTEGER NOT NULL,
    "fromNodeId" INTEGER NOT NULL,
    "toNodeId" INTEGER NOT NULL,
    "condition" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "label" VARCHAR(128),

    CONSTRAINT "workflow_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_voter_rules" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "nodeId" INTEGER NOT NULL,
    "voterType" "VoterType" NOT NULL,
    "voterValue" JSONB NOT NULL,
    "weight" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "node_voter_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_vote_rules" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "nodeId" INTEGER NOT NULL,
    "passRule" "PassRule" NOT NULL,
    "passThreshold" DECIMAL(10,4),
    "rejectRule" "RejectRule" NOT NULL DEFAULT 'NONE',
    "rejectThreshold" DECIMAL(10,4),
    "abstainPolicy" "AbstainPolicy" NOT NULL DEFAULT 'EXCLUDE_FROM_DENOMINATOR',
    "timeoutPolicy" "TimeoutPolicy" NOT NULL DEFAULT 'REMIND_ONLY',
    "visibility" "VoteVisibility" NOT NULL DEFAULT 'RESULT_ONLY',
    "viewScope" "VoteViewScope" NOT NULL DEFAULT 'DEPT_ONLY',
    "allowAbstain" BOOLEAN NOT NULL DEFAULT false,
    "requireAllVote" BOOLEAN NOT NULL DEFAULT true,
    "revotePolicy" "RevotePolicy" NOT NULL DEFAULT 'UNLIMITED_BEFORE_CONCLUSION',
    "vetoTerminates" BOOLEAN NOT NULL DEFAULT false,
    "tiePolicy" "TiePolicy" NOT NULL DEFAULT 'ESCALATE',
    "conclusionMode" "ConclusionMode" NOT NULL DEFAULT 'MANUAL_CONFIRM',
    "conclusionAuthorRule" JSONB,
    "timeoutHours" INTEGER NOT NULL DEFAULT 24,
    "remindIntervalHours" INTEGER NOT NULL DEFAULT 8,
    "maxRemindRounds" INTEGER NOT NULL DEFAULT 3,
    "conclusionTimeoutHours" INTEGER NOT NULL DEFAULT 24,
    "quorumPolicy" "QuorumPolicy" NOT NULL DEFAULT 'MIN_POOL_RATIO',
    "minQuorum" DECIMAL(5,4) NOT NULL DEFAULT 0.6,
    "allowMarkAbsent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "node_vote_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_task_templates" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "nodeId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "assigneeRule" JSONB NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueOffset" INTEGER NOT NULL DEFAULT 24,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "acceptanceRule" JSONB,
    "triggerOn" VARCHAR(16) NOT NULL DEFAULT 'PASS',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_escalation_rules" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "nodeId" INTEGER NOT NULL,
    "triggerType" "EscalationTrigger" NOT NULL,
    "condition" JSONB,
    "targetDeptRule" "TargetDeptRule" NOT NULL DEFAULT 'DIRECT_PARENT',
    "targetValue" JSONB,
    "timeout" INTEGER NOT NULL DEFAULT 48,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "freezeSource" BOOLEAN NOT NULL DEFAULT true,
    "maxLevel" INTEGER NOT NULL DEFAULT 5,
    "acceptMode" "EscalationAcceptMode" NOT NULL DEFAULT 'AUTO',
    "onMissingWorkNo" "WorkNoMissingPolicy" NOT NULL DEFAULT 'ESCALATE_UP',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "templateId" INTEGER NOT NULL,
    "templateVersionId" INTEGER NOT NULL,
    "initiatorId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(500),
    "formData" JSONB NOT NULL DEFAULT '{}',
    "status" "InstanceStatus" NOT NULL DEFAULT 'DRAFT',
    "currentNodeId" INTEGER,
    "layerIndex" INTEGER NOT NULL DEFAULT 0,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "suspendedFrom" "InstanceStatus",
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instance_nodes" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "instanceId" INTEGER NOT NULL,
    "nodeId" INTEGER NOT NULL,
    "type" "WorkflowNodeType" NOT NULL,
    "status" "InstanceNodeStatus" NOT NULL DEFAULT 'PENDING',
    "layerIndex" INTEGER NOT NULL DEFAULT 0,
    "round" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "deadline" TIMESTAMPTZ(3),
    "result" JSONB,
    "escalationId" INTEGER,
    "conclusionStatus" "ConclusionStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "conclusionDeadline" TIMESTAMPTZ(3),
    "vetoLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instance_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instance_node_voters" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "instanceNodeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "weight" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "status" "VoterStatus" NOT NULL DEFAULT 'PENDING',
    "votedAt" TIMESTAMPTZ(3),
    "sourceRuleId" INTEGER,
    "sourceReason" VARCHAR(255),
    "delegateFromUserId" INTEGER,
    "remindedAt" TIMESTAMPTZ(3),
    "remindCount" INTEGER NOT NULL DEFAULT 0,
    "absentAt" TIMESTAMPTZ(3),
    "absentById" INTEGER,
    "absentReason" VARCHAR(500),
    "absentSource" "AbsenceSource",
    "excludedWeight" DECIMAL(10,4),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instance_node_voters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "instanceNodeId" INTEGER NOT NULL,
    "voterId" INTEGER NOT NULL,
    "decision" "VoteDecision" NOT NULL,
    "comment" TEXT,
    "weight" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "revoteSeq" INTEGER NOT NULL DEFAULT 1,
    "isReplaced" BOOLEAN NOT NULL DEFAULT false,
    "replacedById" INTEGER,
    "delegateFromUserId" INTEGER,
    "ip" VARCHAR(64),
    "ua" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_results" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "instanceNodeId" INTEGER NOT NULL,
    "approveCount" INTEGER NOT NULL DEFAULT 0,
    "rejectCount" INTEGER NOT NULL DEFAULT 0,
    "abstainCount" INTEGER NOT NULL DEFAULT 0,
    "weightedScore" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "denominator" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "isProvisional" BOOLEAN NOT NULL DEFAULT true,
    "snapshot" JSONB NOT NULL,
    "ruleSnapshot" JSONB,
    "tieResolvedBy" VARCHAR(32),
    "decidedBy" INTEGER,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vote_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_conclusions" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "instanceNodeId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "authorId" INTEGER,
    "decision" "ConclusionDecision" NOT NULL,
    "systemDecision" "ConclusionDecision" NOT NULL,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" VARCHAR(2000),
    "content" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "source" VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vote_conclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instance_suspensions" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "instanceId" INTEGER NOT NULL,
    "escalationId" INTEGER,
    "frozenStatus" "InstanceStatus" NOT NULL,
    "frozenNodeId" INTEGER,
    "suspendedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumedAt" TIMESTAMPTZ(3),
    "resumeAction" VARCHAR(64),

    CONSTRAINT "instance_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "instanceId" INTEGER,
    "instanceNodeId" INTEGER,
    "parentTaskId" INTEGER,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING_ASSIGN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "creatorId" INTEGER NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "blockedReason" VARCHAR(500),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "overdueNotifiedAt" TIMESTAMPTZ(3),
    "sourceEscalationId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignees" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "TaskAssigneeRole" NOT NULL,
    "weight" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedBy" INTEGER,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "dependsOnTaskId" INTEGER NOT NULL,
    "type" "TaskDependencyType" NOT NULL DEFAULT 'FINISH_TO_START',

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_checklists" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "content" VARCHAR(200) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "task_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_logs" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus",
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "sourceType" "EscalationSourceType" NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "instanceId" INTEGER,
    "taskId" INTEGER,
    "fromDeptId" INTEGER NOT NULL,
    "toDeptId" INTEGER NOT NULL,
    "fromWorkNo" VARCHAR(64),
    "toWorkNo" VARCHAR(64),
    "reason" TEXT NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'PENDING',
    "level" INTEGER NOT NULL DEFAULT 1,
    "triggerType" "EscalationTrigger" NOT NULL DEFAULT 'MANUAL',
    "targetRule" "TargetDeptRule" NOT NULL DEFAULT 'DIRECT_PARENT',
    "requestedBy" INTEGER NOT NULL,
    "handledBy" INTEGER,
    "handledAt" TIMESTAMPTZ(3),
    "deadline" TIMESTAMPTZ(3),
    "frozenInstanceStatus" "InstanceStatus",
    "maxLevel" INTEGER NOT NULL DEFAULT 5,
    "upwardInstanceNodeId" INTEGER,
    "upwardVoteRound" INTEGER NOT NULL DEFAULT 1,
    "finalOpinion" TEXT,
    "writeBackAction" "WriteBackAction",
    "result" VARCHAR(64),
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_chains" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "escalationId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "deptId" INTEGER NOT NULL,
    "workNo" VARCHAR(64),
    "handlerId" INTEGER,
    "instanceNodeId" INTEGER,
    "status" "EscalationStatus" NOT NULL DEFAULT 'PENDING',
    "actionType" "EscalationAction",
    "comment" TEXT,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMPTZ(3),
    "handledAt" TIMESTAMPTZ(3),

    CONSTRAINT "escalation_chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_records" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "escalationId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" "EscalationAction" NOT NULL,
    "fromStatus" "EscalationStatus",
    "toStatus" "EscalationStatus",
    "comment" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "targetType" VARCHAR(32) NOT NULL,
    "targetId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" INTEGER,
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "targetType" VARCHAR(32) NOT NULL,
    "targetId" INTEGER NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileKey" VARCHAR(512) NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" VARCHAR(128) NOT NULL,
    "uploaderId" INTEGER NOT NULL,
    "storageDriver" "StorageDriver" NOT NULL DEFAULT 'local',
    "checksum" VARCHAR(128),
    "status" VARCHAR(16) NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT,
    "link" VARCHAR(512),
    "level" VARCHAR(16) NOT NULL DEFAULT 'INFO',
    "channel" VARCHAR(16) NOT NULL DEFAULT 'INAPP',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ(3),
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "actorId" INTEGER,
    "action" VARCHAR(64) NOT NULL,
    "targetType" VARCHAR(32) NOT NULL,
    "targetId" VARCHAR(64) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(64),
    "ua" VARCHAR(512),
    "traceId" VARCHAR(64),
    "result" VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "aggregateType" VARCHAR(32) NOT NULL,
    "aggregateId" VARCHAR(64) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(500),
    "source" "AbsenceSource" NOT NULL DEFAULT 'MANUAL',
    "createdBy" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegations" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "fromUserId" INTEGER NOT NULL,
    "toUserId" INTEGER NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'SELF',
    "scopeId" INTEGER,
    "reason" VARCHAR(500),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "period" VARCHAR(16) NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "responseHash" VARCHAR(128),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "eventTypes" JSONB NOT NULL DEFAULT '[]',
    "url" VARCHAR(512) NOT NULL,
    "secret" VARCHAR(255),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "users_tenantId_status_idx" ON "users"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_phone_key" ON "users"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "departments_tenantId_parentId_idx" ON "departments"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "departments_tenantId_path_idx" ON "departments"("tenantId", "path" text_pattern_ops);

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_code_key" ON "departments"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_workNo_key" ON "departments"("tenantId", "workNo");

-- CreateIndex
CREATE INDEX "department_workno_members_tenantId_userId_idx" ON "department_workno_members"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "department_workno_members_departmentId_userId_key" ON "department_workno_members"("departmentId", "userId");

-- CreateIndex
CREATE INDEX "user_departments_departmentId_isLeader_idx" ON "user_departments"("departmentId", "isLeader");

-- CreateIndex
CREATE UNIQUE INDEX "user_departments_userId_departmentId_key" ON "user_departments"("userId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_code_key" ON "roles"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "user_roles_scopeType_scopeId_idx" ON "user_roles"("scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_scopeType_scopeId_key" ON "user_roles"("userId", "roleId", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "vote_groups_tenantId_code_key" ON "vote_groups"("tenantId", "code");

-- CreateIndex
CREATE INDEX "workflow_templates_tenantId_status_idx" ON "workflow_templates"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_templates_tenantId_code_key" ON "workflow_templates"("tenantId", "code");

-- CreateIndex
CREATE INDEX "workflow_versions_tenantId_templateId_idx" ON "workflow_versions"("tenantId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_templateId_version_key" ON "workflow_versions"("templateId", "version");

-- CreateIndex
CREATE INDEX "workflow_nodes_versionId_order_idx" ON "workflow_nodes"("versionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_nodes_versionId_nodeKey_key" ON "workflow_nodes"("versionId", "nodeKey");

-- CreateIndex
CREATE INDEX "workflow_edges_versionId_fromNodeId_priority_idx" ON "workflow_edges"("versionId", "fromNodeId", "priority");

-- CreateIndex
CREATE INDEX "node_voter_rules_nodeId_idx" ON "node_voter_rules"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "node_vote_rules_nodeId_key" ON "node_vote_rules"("nodeId");

-- CreateIndex
CREATE INDEX "node_task_templates_nodeId_order_idx" ON "node_task_templates"("nodeId", "order");

-- CreateIndex
CREATE INDEX "node_escalation_rules_nodeId_triggerType_idx" ON "node_escalation_rules"("nodeId", "triggerType");

-- CreateIndex
CREATE INDEX "workflow_instances_tenantId_status_startedAt_idx" ON "workflow_instances"("tenantId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "workflow_instances_tenantId_initiatorId_status_idx" ON "workflow_instances"("tenantId", "initiatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_tenantId_code_key" ON "workflow_instances"("tenantId", "code");

-- CreateIndex
CREATE INDEX "instance_nodes_tenantId_status_deadline_idx" ON "instance_nodes"("tenantId", "status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "instance_nodes_instanceId_nodeId_round_key" ON "instance_nodes"("instanceId", "nodeId", "round");

-- CreateIndex
CREATE INDEX "instance_node_voters_instanceNodeId_status_idx" ON "instance_node_voters"("instanceNodeId", "status");

-- CreateIndex
CREATE INDEX "instance_node_voters_tenantId_userId_status_idx" ON "instance_node_voters"("tenantId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "instance_node_voters_instanceNodeId_userId_key" ON "instance_node_voters"("instanceNodeId", "userId");

-- CreateIndex
CREATE INDEX "votes_instanceNodeId_isReplaced_idx" ON "votes"("instanceNodeId", "isReplaced");

-- CreateIndex
CREATE UNIQUE INDEX "votes_instanceNodeId_voterId_revoteSeq_key" ON "votes"("instanceNodeId", "voterId", "revoteSeq");

-- CreateIndex
CREATE UNIQUE INDEX "vote_results_instanceNodeId_key" ON "vote_results"("instanceNodeId");

-- CreateIndex
CREATE INDEX "vote_conclusions_tenantId_authorId_createdAt_idx" ON "vote_conclusions"("tenantId", "authorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "vote_conclusions_instanceNodeId_round_key" ON "vote_conclusions"("instanceNodeId", "round");

-- CreateIndex
CREATE INDEX "instance_suspensions_instanceId_resumedAt_idx" ON "instance_suspensions"("instanceId", "resumedAt");

-- CreateIndex
CREATE INDEX "tasks_tenantId_status_dueAt_idx" ON "tasks"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_instanceId_idx" ON "tasks"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_tenantId_code_key" ON "tasks"("tenantId", "code");

-- CreateIndex
CREATE INDEX "task_assignees_userId_isActive_idx" ON "task_assignees"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignees_taskId_userId_role_key" ON "task_assignees"("taskId", "userId", "role");

-- CreateIndex
CREATE INDEX "task_dependencies_dependsOnTaskId_idx" ON "task_dependencies"("dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependsOnTaskId_key" ON "task_dependencies"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "task_checklists_taskId_order_idx" ON "task_checklists"("taskId", "order");

-- CreateIndex
CREATE INDEX "task_logs_taskId_createdAt_idx" ON "task_logs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "escalations_tenantId_toWorkNo_status_idx" ON "escalations"("tenantId", "toWorkNo", "status");

-- CreateIndex
CREATE INDEX "escalations_toDeptId_status_idx" ON "escalations"("toDeptId", "status");

-- CreateIndex
CREATE INDEX "escalations_instanceId_idx" ON "escalations"("instanceId");

-- CreateIndex
CREATE INDEX "escalations_tenantId_status_createdAt_idx" ON "escalations"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "escalation_chains_tenantId_workNo_status_idx" ON "escalation_chains"("tenantId", "workNo", "status");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_chains_escalationId_level_key" ON "escalation_chains"("escalationId", "level");

-- CreateIndex
CREATE INDEX "escalation_records_escalationId_createdAt_idx" ON "escalation_records"("escalationId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_targetType_targetId_createdAt_idx" ON "comments"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_fileKey_key" ON "attachments"("fileKey");

-- CreateIndex
CREATE INDEX "attachments_targetType_targetId_idx" ON "attachments"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "notifications_userId_read_createdAt_idx" ON "notifications"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_type_idx" ON "notifications"("tenantId", "type");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_targetType_targetId_createdAt_idx" ON "audit_logs"("tenantId", "targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_actorId_createdAt_idx" ON "audit_logs"("tenantId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_status_availableAt_idx" ON "outbox_events"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_events_aggregateType_aggregateId_sequence_idx" ON "outbox_events"("aggregateType", "aggregateId", "sequence");

-- CreateIndex
CREATE INDEX "absences_tenantId_userId_startAt_endAt_idx" ON "absences"("tenantId", "userId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "delegations_tenantId_fromUserId_status_idx" ON "delegations"("tenantId", "fromUserId", "status");

-- CreateIndex
CREATE INDEX "delegations_tenantId_toUserId_status_idx" ON "delegations"("tenantId", "toUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_tenantId_type_period_key" ON "number_sequences"("tenantId", "type", "period");

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenantId_scope_key_key" ON "idempotency_keys"("tenantId", "scope", "key");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_tenantId_enabled_idx" ON "webhook_subscriptions"("tenantId", "enabled");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_workno_members" ADD CONSTRAINT "department_workno_members_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_workno_members" ADD CONSTRAINT "department_workno_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_group_members" ADD CONSTRAINT "vote_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "vote_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "workflow_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "workflow_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_voter_rules" ADD CONSTRAINT "node_voter_rules_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_vote_rules" ADD CONSTRAINT "node_vote_rules_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_task_templates" ADD CONSTRAINT "node_task_templates_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_escalation_rules" ADD CONSTRAINT "node_escalation_rules_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_nodes" ADD CONSTRAINT "instance_nodes_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_nodes" ADD CONSTRAINT "instance_nodes_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "workflow_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_node_voters" ADD CONSTRAINT "instance_node_voters_instanceNodeId_fkey" FOREIGN KEY ("instanceNodeId") REFERENCES "instance_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_node_voters" ADD CONSTRAINT "instance_node_voters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_instanceNodeId_fkey" FOREIGN KEY ("instanceNodeId") REFERENCES "instance_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_results" ADD CONSTRAINT "vote_results_instanceNodeId_fkey" FOREIGN KEY ("instanceNodeId") REFERENCES "instance_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_conclusions" ADD CONSTRAINT "vote_conclusions_instanceNodeId_fkey" FOREIGN KEY ("instanceNodeId") REFERENCES "instance_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_conclusions" ADD CONSTRAINT "vote_conclusions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_suspensions" ADD CONSTRAINT "instance_suspensions_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_instanceNodeId_fkey" FOREIGN KEY ("instanceNodeId") REFERENCES "instance_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_logs" ADD CONSTRAINT "task_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_handledBy_fkey" FOREIGN KEY ("handledBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_chains" ADD CONSTRAINT "escalation_chains_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_records" ADD CONSTRAINT "escalation_records_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
