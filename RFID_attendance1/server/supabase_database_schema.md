CREATE TABLE public.attendance (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  student_id character varying NOT NULL,
  card_uid character varying NOT NULL,
  fullname character varying NOT NULL,
  grade character varying NOT NULL,
  section character varying NOT NULL,
  scanned_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT attendance_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id),
  CONSTRAINT attendance_card_uid_fkey FOREIGN KEY (card_uid) REFERENCES public.students(card_uid)
);
CREATE TABLE public.students (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  student_id character varying NOT NULL UNIQUE,
  card_uid character varying NOT NULL UNIQUE,
  fullname character varying NOT NULL,
  grade character varying NOT NULL,
  section character varying NOT NULL,
  registered_date timestamp without time zone,
  CONSTRAINT students_pkey PRIMARY KEY (id)
);
CREATE TABLE public.teachers (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  teachers_id character varying NOT NULL UNIQUE,
  fullname character varying NOT NULL,
  email character varying NOT NULL UNIQUE,
  password character varying NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT teachers_pkey PRIMARY KEY (id)
);