export interface BirthdayConfig {
  id: string;
  type: string;
  title: string;
  content: string;
  sortOrder: number;
  isActive: boolean;
}

export interface AnimatedStatProps {
  value: number;
  suffix?: string;
  label: string;
  icon: React.ReactNode;
}

export interface CategoryCardProps {
  cat: {
    title: string;
    icon: React.ReactNode;
    desc: string;
    link: string;
  };
}

export interface HomeFeedResponse {
  hotPosts?: PostItem[];
  recentPosts?: PostItem[];
}

export interface PostItem {
  id: string;
  title: string;
  section: string;
  content: string;
  commentsCount?: number;
  likesCount?: number;
  updatedAt?: string;
}
