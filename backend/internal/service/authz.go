package service

import (
	"fmt"

	"github.com/oralhistory/oralhistory/internal/constants"
	"github.com/oralhistory/oralhistory/internal/model"
	"github.com/oralhistory/oralhistory/internal/util"
)

// 本文件集中实现跨实体的授权与状态守卫：
//   - requireRoles        角色白名单（越权操作拒绝）
//   - requireProjectOwner 采访员只能维护自己负责的项目（管理员除外）
//   - requireProjectWritable 已归档项目禁止继续写入

// requireRoles 校验操作者角色是否在允许列表内。
func requireRoles(actor *model.User, roles ...string) error {
	for _, r := range roles {
		if actor.Role == r {
			return nil
		}
	}
	return util.NewAppError(constants.CodeForbidden,
		fmt.Sprintf("用户 %s 的角色 %s 无权执行该操作", actor.Username, actor.Role), nil)
}

// requireProjectOwner 校验操作者是项目负责人或管理员。
func requireProjectOwner(actor *model.User, project *model.Project) error {
	if actor.Role == constants.RoleAdmin {
		return nil
	}
	if project.CreatedBy != actor.ID {
		return util.NewAppError(constants.CodeForbidden,
			fmt.Sprintf("项目 %d 由用户 %d 负责，%s 无权操作", project.ID, project.CreatedBy, actor.Username), nil)
	}
	return nil
}

// requireProjectWritable 校验项目未归档，已归档项目拒绝一切写入。
func requireProjectWritable(project *model.Project) error {
	if project.Status == constants.ProjectStatusArchived {
		return util.NewAppError(constants.CodeProjectStatus,
			fmt.Sprintf("项目 %d 已归档，禁止继续写入", project.ID), nil)
	}
	return nil
}
