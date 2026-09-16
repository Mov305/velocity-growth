export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  app: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_owner_of: { Args: { p_brand_id: string }; Returns: boolean }
      schedule_provider_poll: {
        Args: { p_secret: string; p_url: string }
        Returns: string
      }
      user_brand_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      allowed_emails: {
        Row: {
          brand_id: string
          display_name: string
          email: string
          role: Database["public"]["Enums"]["membership_role"]
        }
        Insert: {
          brand_id: string
          display_name: string
          email: string
          role: Database["public"]["Enums"]["membership_role"]
        }
        Update: {
          brand_id?: string
          display_name?: string
          email?: string
          role?: Database["public"]["Enums"]["membership_role"]
        }
        Relationships: [
          {
            foreignKeyName: "allowed_emails_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          code: string
          country: string
          created_at: string
          id: string
          name: string
          timezone: string
        }
        Insert: {
          code: string
          country: string
          created_at?: string
          id?: string
          name: string
          timezone: string
        }
        Update: {
          code?: string
          country?: string
          created_at?: string
          id?: string
          name?: string
          timezone?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          brand_id: string
          channel: Database["public"]["Enums"]["channel"]
          created_at: string
          external_id: string
          flags: string[]
          id: string
          name: string
          parent_campaign_id: string | null
          parent_external_id: string | null
          reported_bounced: number | null
          reported_clicks: number | null
          reported_delivered: number | null
          reported_opens: number | null
          reported_sent: number | null
          send_local_time: string | null
          sent_at: string | null
          source_import_id: string | null
          spend: number | null
          target_country: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          channel: Database["public"]["Enums"]["channel"]
          created_at?: string
          external_id: string
          flags?: string[]
          id?: string
          name: string
          parent_campaign_id?: string | null
          parent_external_id?: string | null
          reported_bounced?: number | null
          reported_clicks?: number | null
          reported_delivered?: number | null
          reported_opens?: number | null
          reported_sent?: number | null
          send_local_time?: string | null
          sent_at?: string | null
          source_import_id?: string | null
          spend?: number | null
          target_country?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          channel?: Database["public"]["Enums"]["channel"]
          created_at?: string
          external_id?: string
          flags?: string[]
          id?: string
          name?: string
          parent_campaign_id?: string | null
          parent_external_id?: string | null
          reported_bounced?: number | null
          reported_clicks?: number | null
          reported_delivered?: number | null
          reported_opens?: number | null
          reported_sent?: number | null
          send_local_time?: string | null
          sent_at?: string | null
          source_import_id?: string | null
          spend?: number | null
          target_country?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_parent_campaign_id_fkey"
            columns: ["parent_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          brand_id: string
          city: string | null
          consent_marketing: boolean
          country: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          external_id: string
          flags: string[]
          full_name: string | null
          id: string
          notes: string | null
          phone: string | null
          signup_at: string | null
          source_import_id: string | null
          status: Database["public"]["Enums"]["contact_status"]
          suppressed_until: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          city?: string | null
          consent_marketing: boolean
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          external_id: string
          flags?: string[]
          full_name?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          signup_at?: string | null
          source_import_id?: string | null
          status: Database["public"]["Enums"]["contact_status"]
          suppressed_until?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          city?: string | null
          consent_marketing?: boolean
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          external_id?: string
          flags?: string[]
          full_name?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          signup_at?: string | null
          source_import_id?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          suppressed_until?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_events: {
        Row: {
          brand_id: string
          campaign_id: string
          channel: Database["public"]["Enums"]["channel"]
          contact_id: string
          event_id: string
          event_type: Database["public"]["Enums"]["engagement_event_type"]
          id: number
          occurred_at: string
          raw_event_type: string
          source_import_id: string | null
        }
        Insert: {
          brand_id: string
          campaign_id: string
          channel: Database["public"]["Enums"]["channel"]
          contact_id: string
          event_id: string
          event_type: Database["public"]["Enums"]["engagement_event_type"]
          id?: never
          occurred_at: string
          raw_event_type: string
          source_import_id?: string | null
        }
        Update: {
          brand_id?: string
          campaign_id?: string
          channel?: Database["public"]["Enums"]["channel"]
          contact_id?: string
          event_id?: string
          event_type?: Database["public"]["Enums"]["engagement_event_type"]
          id?: never
          occurred_at?: string
          raw_event_type?: string
          source_import_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rejects: {
        Row: {
          brand_id: string
          id: number
          import_id: string
          raw: Json
          reason: string
          row_number: number
        }
        Insert: {
          brand_id: string
          id?: never
          import_id: string
          raw: Json
          reason: string
          row_number: number
        }
        Update: {
          brand_id?: string
          id?: never
          import_id?: string
          raw?: Json
          reason?: string
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_rejects_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rejects_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          brand_id: string
          encoding: string
          error: string | null
          file_name: string
          file_sha256: string
          finished_at: string | null
          id: string
          kind: Database["public"]["Enums"]["import_kind"]
          rows_already_present: number
          rows_read: number
          rows_rejected: number
          rows_skipped_duplicate: number
          rows_upserted: number
          started_at: string
          status: Database["public"]["Enums"]["import_status"]
        }
        Insert: {
          brand_id: string
          encoding: string
          error?: string | null
          file_name: string
          file_sha256: string
          finished_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["import_kind"]
          rows_already_present?: number
          rows_read?: number
          rows_rejected?: number
          rows_skipped_duplicate?: number
          rows_upserted?: number
          started_at?: string
          status?: Database["public"]["Enums"]["import_status"]
        }
        Update: {
          brand_id?: string
          encoding?: string
          error?: string | null
          file_name?: string
          file_sha256?: string
          finished_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["import_kind"]
          rows_already_present?: number
          rows_read?: number
          rows_rejected?: number
          rows_skipped_duplicate?: number
          rows_upserted?: number
          started_at?: string
          status?: Database["public"]["Enums"]["import_status"]
        }
        Relationships: [
          {
            foreignKeyName: "imports_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          brand_id: string
          created_at: string
          role: Database["public"]["Enums"]["membership_role"]
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          role: Database["public"]["Enums"]["membership_role"]
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["membership_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_events: {
        Row: {
          brand_id: string
          event_type: string
          id: number
          occurred_at: string | null
          provider_event_id: string
          raw: Json
          received_at: string
          recipient_id: string | null
          send_id: string
        }
        Insert: {
          brand_id: string
          event_type: string
          id?: never
          occurred_at?: string | null
          provider_event_id: string
          raw: Json
          received_at?: string
          recipient_id?: string | null
          send_id: string
        }
        Update: {
          brand_id?: string
          event_type?: string
          id?: never
          occurred_at?: string | null
          provider_event_id?: string
          raw?: Json
          received_at?: string
          recipient_id?: string | null
          send_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_events_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_events_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "sends"
            referencedColumns: ["id"]
          },
        ]
      }
      send_log_entries: {
        Row: {
          attempt_no: number
          batch_key: string
          brand_id: string
          campaign_external_id: string
          campaign_id: string | null
          id: number
          queued_at: string
          recipient_count: number
          source_import_id: string | null
          status: string
        }
        Insert: {
          attempt_no: number
          batch_key: string
          brand_id: string
          campaign_external_id: string
          campaign_id?: string | null
          id?: never
          queued_at: string
          recipient_count: number
          source_import_id?: string | null
          status: string
        }
        Update: {
          attempt_no?: number
          batch_key?: string
          brand_id?: string
          campaign_external_id?: string
          campaign_id?: string | null
          id?: never
          queued_at?: string
          recipient_count?: number
          source_import_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "send_log_entries_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "send_log_entries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "send_log_entries_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      send_recipients: {
        Row: {
          brand_id: string
          contact_id: string
          last_event_at: string | null
          send_id: string
          status: Database["public"]["Enums"]["recipient_status"]
        }
        Insert: {
          brand_id: string
          contact_id: string
          last_event_at?: string | null
          send_id: string
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Update: {
          brand_id?: string
          contact_id?: string
          last_event_at?: string | null
          send_id?: string
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Relationships: [
          {
            foreignKeyName: "send_recipients_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "send_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "send_recipients_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "sends"
            referencedColumns: ["id"]
          },
        ]
      }
      sends: {
        Row: {
          approved_at: string
          approved_by: string
          approved_count: number
          audience_definition: string
          brand_id: string
          campaign_id: string
          created_at: string
          dispatch_started_at: string | null
          dispatched_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_polled_at: string | null
          poll_complete: boolean
          poll_cursor: string | null
          provider_accepted: number | null
          provider_batch_id: string | null
          provider_rejected: number | null
          status: Database["public"]["Enums"]["send_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          approved_count: number
          audience_definition: string
          brand_id: string
          campaign_id: string
          created_at?: string
          dispatch_started_at?: string | null
          dispatched_at?: string | null
          id?: string
          idempotency_key: string
          last_error?: string | null
          last_polled_at?: string | null
          poll_complete?: boolean
          poll_cursor?: string | null
          provider_accepted?: number | null
          provider_batch_id?: string | null
          provider_rejected?: number | null
          status?: Database["public"]["Enums"]["send_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          approved_count?: number
          audience_definition?: string
          brand_id?: string
          campaign_id?: string
          created_at?: string
          dispatch_started_at?: string | null
          dispatched_at?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          last_polled_at?: string | null
          poll_complete?: boolean
          poll_cursor?: string | null
          provider_accepted?: number | null
          provider_batch_id?: string | null
          provider_rejected?: number | null
          status?: Database["public"]["Enums"]["send_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sends_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      share_links: {
        Row: {
          brand_id: string
          campaign_id: string
          created_at: string
          created_by: string
          expires_at: string
          failed_attempts: number
          id: string
          locked_until: string | null
          password_hash: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          brand_id: string
          campaign_id: string
          created_at?: string
          created_by: string
          expires_at: string
          failed_attempts?: number
          id?: string
          locked_until?: string | null
          password_hash: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          brand_id?: string
          campaign_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          locked_until?: string | null
          password_hash?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_links_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      import_reject_summary: {
        Row: {
          brand_id: string | null
          import_id: string | null
          reason: string | null
          rows: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_rejects_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rejects_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_send: { Args: { p_campaign_id: string }; Returns: string }
      begin_dispatch: {
        Args: { p_send_id: string }
        Returns: {
          approved_at: string
          approved_by: string
          approved_count: number
          audience_definition: string
          brand_id: string
          campaign_id: string
          created_at: string
          dispatch_started_at: string | null
          dispatched_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_polled_at: string | null
          poll_complete: boolean
          poll_cursor: string | null
          provider_accepted: number | null
          provider_batch_id: string | null
          provider_rejected: number | null
          status: Database["public"]["Enums"]["send_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sends"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      campaign_performance: {
        Args: never
        Returns: {
          channel: Database["public"]["Enums"]["channel"]
          external_id: string
          id: string
          name: string
          observed_bounced: number
          observed_clicked: number
          observed_complained: number
          observed_contacts: number
          observed_events: number
          observed_opened: number
          observed_unsubscribed: number
          reported_bounced: number
          reported_clicks: number
          reported_delivered: number
          reported_opens: number
          reported_sent: number
          sent_at: string
          spend: number
        }[]
      }
      complete_dispatch: {
        Args: {
          p_accepted: string[]
          p_batch_id: string
          p_rejected: string[]
          p_send_id: string
        }
        Returns: undefined
      }
      contact_is_contactable: {
        Args: { c: Database["public"]["Tables"]["contacts"]["Row"] }
        Returns: boolean
      }
      contactable_contact_ids: { Args: never; Returns: string[] }
      dashboard_summary: {
        Args: never
        Returns: {
          contactable: number
          contactable_definition: string
          deleted_customers: number
          not_contactable: number
          total_customers: number
        }[]
      }
      fail_dispatch: {
        Args: { p_error: string; p_send_id: string }
        Returns: undefined
      }
      ingest_provider_events: {
        Args: { p_events: Json; p_send_id: string }
        Returns: {
          duplicates: number
          inserted: number
          unknown_recipients: number
        }[]
      }
      open_share_link: {
        Args: { p_password: string; p_token: string }
        Returns: {
          brand_id: string
          campaign_id: string
          expires_at: string
          link_id: string
          outcome: string
        }[]
      }
      preview_send_audience: {
        Args: { p_campaign_id: string }
        Returns: {
          audience_count: number
          audience_definition: string
        }[]
      }
      publish_results: {
        Args: { p_campaign_id: string; p_password: string }
        Returns: string
      }
      revoke_share_link: { Args: { p_link_id: string }; Returns: undefined }
      send_outcomes: {
        Args: { p_send_id: string }
        Returns: {
          accepted: number
          bounced: number
          clicked: number
          complained: number
          delivered: number
          events: number
          opened: number
          queued: number
          rejected: number
          total: number
          unsubscribed: number
        }[]
      }
      share_results: {
        Args: { p_link_id: string }
        Returns: {
          approved: number
          bounced: number
          brand_name: string
          campaign_external_id: string
          campaign_name: string
          channel: string
          clicked: number
          complained: number
          delivered: number
          expires_at: string
          last_dispatched_at: string
          log_events: Json
          opened: number
          pending: number
          rejected: number
          sends: number
          unsubscribed: number
        }[]
      }
      signups_last_30_days: {
        Args: never
        Returns: {
          day: string
          signups: number
        }[]
      }
    }
    Enums: {
      channel: "email" | "sms"
      contact_status: "active" | "unsubscribed" | "bounced" | "pending"
      engagement_event_type:
        | "open"
        | "click"
        | "bounce"
        | "complaint"
        | "unsubscribe"
        | "delivered"
        | "unknown"
      import_kind: "contacts" | "campaigns" | "events" | "send_log"
      import_status: "running" | "succeeded" | "failed"
      membership_role: "owner" | "analyst"
      recipient_status:
        | "queued"
        | "accepted"
        | "rejected"
        | "delivered"
        | "bounced"
        | "opened"
        | "clicked"
        | "unsubscribed"
        | "complained"
      send_status: "approved" | "dispatching" | "dispatched" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  app: {
    Enums: {},
  },
  public: {
    Enums: {
      channel: ["email", "sms"],
      contact_status: ["active", "unsubscribed", "bounced", "pending"],
      engagement_event_type: [
        "open",
        "click",
        "bounce",
        "complaint",
        "unsubscribe",
        "delivered",
        "unknown",
      ],
      import_kind: ["contacts", "campaigns", "events", "send_log"],
      import_status: ["running", "succeeded", "failed"],
      membership_role: ["owner", "analyst"],
      recipient_status: [
        "queued",
        "accepted",
        "rejected",
        "delivered",
        "bounced",
        "opened",
        "clicked",
        "unsubscribed",
        "complained",
      ],
      send_status: ["approved", "dispatching", "dispatched", "failed"],
    },
  },
} as const

