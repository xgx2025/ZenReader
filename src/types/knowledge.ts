/** A user-authored topic is the durable unit of the knowledge system. */
export interface KnowledgeTopic {
  id: string
  title: string
  domain: string
  summary: string
  createdAt: string
  updatedAt: string
  revisions: { summary: string; savedAt: string }[]
}

export type KnowledgeRelationKind = 'depends' | 'related' | 'contrasts'

export interface KnowledgeRelation {
  id: string
  fromId: string
  toId: string
  kind: KnowledgeRelationKind
}

export type EvidenceRole = 'supports' | 'extends' | 'questions'

export interface KnowledgeEvidence {
  topicId: string
  noteId: string
  role: EvidenceRole
}

export interface KnowledgeMapData {
  topics: KnowledgeTopic[]
  relations: KnowledgeRelation[]
  evidence: KnowledgeEvidence[]
}

export const EMPTY_KNOWLEDGE_MAP: KnowledgeMapData = {
  topics: [],
  relations: [],
  evidence: [],
}
