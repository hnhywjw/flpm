-- ============================================================
-- 迁移 014：给 boss / admin 角色授予「系统管理」菜单
-- ============================================================
PRAGMA foreign_keys = ON;

-- 用 JSON 数组追加 system（先判断是否已含，避免重复）
UPDATE roles
SET menus = (
  SELECT json_group_array(DISTINCT value)
  FROM (
    SELECT value FROM json_each(roles.menus)
    UNION ALL
    SELECT 'system'
  )
)
WHERE key IN ('boss', 'admin')
  AND menus NOT LIKE '%"system"%';
