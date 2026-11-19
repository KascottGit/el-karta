export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      ai_runs: {
        Row: {
          created_at: string;
          id: string;
          images: number | null;
          input_tokens: number | null;
          model: string;
          output_tokens: number | null;
          pass: string;
          project_id: string;
          provider: string;
          status: string;
          user_id: string;
          validation_retries: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          images?: number | null;
          input_tokens?: number | null;
          model: string;
          output_tokens?: number | null;
          pass: string;
          project_id: string;
          provider: string;
          status: string;
          user_id?: string;
          validation_retries?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          images?: number | null;
          input_tokens?: number | null;
          model?: string;
          output_tokens?: number | null;
          pass?: string;
          project_id?: string;
          provider?: string;
          status?: string;
          user_id?: string;
          validation_retries?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_runs_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      attachments: {
        Row: {
          created_at: string;
          floor_id: string | null;
          id: string;
          kind: string;
          project_id: string;
          region: Json | null;
          storage_path: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          floor_id?: string | null;
          id?: string;
          kind: string;
          project_id: string;
          region?: Json | null;
          storage_path: string;
        };
        Update: {
          created_at?: string;
          floor_id?: string | null;
          id?: string;
          kind?: string;
          project_id?: string;
          region?: Json | null;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'attachments_floor_id_fkey';
            columns: ['floor_id'];
            isOneToOne: false;
            referencedRelation: 'floors';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attachments_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      floors: {
        Row: {
          building_id: string;
          data: NonNullable<Json>;
          id: string;
          name: string;
          project_id: string;
          schema_version: number;
          sort_order: number;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          building_id: string;
          data: NonNullable<Json>;
          id?: string;
          name: string;
          project_id: string;
          schema_version: number;
          sort_order: number;
          updated_at?: string;
          version?: number;
        };
        Update: {
          building_id?: string;
          data?: NonNullable<Json>;
          id?: string;
          name?: string;
          project_id?: string;
          schema_version?: number;
          sort_order?: number;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'floors_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      project_members: {
        Row: {
          project_id: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          project_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          project_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_members_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      projects: {
        Row: {
          created_at: string;
          data: NonNullable<Json>;
          id: string;
          kind: string;
          name: string;
          owner_id: string;
          schema_version: number;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          data: NonNullable<Json>;
          id?: string;
          kind: string;
          name: string;
          owner_id?: string;
          schema_version: number;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          kind?: string;
          name?: string;
          owner_id?: string;
          schema_version?: number;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_read_project: { Args: { p_project_id: string }; Returns: boolean };
      can_write_project: { Args: { p_project_id: string }; Returns: boolean };
      create_project: { Args: { floors: Json; project: Json }; Returns: string };
      project_role: { Args: { p_project_id: string }; Returns: string };
      share_project: {
        Args: { p_email: string; p_project_id: string; p_role?: string };
        Returns: string;
      };
      storage_project_id: { Args: { object_name: string }; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
