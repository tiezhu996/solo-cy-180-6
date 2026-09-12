package service

import (
	"log/slog"
	"testing"

	"github.com/oralhistory/oralhistory/internal/constants"
	"github.com/oralhistory/oralhistory/internal/dto"
	"github.com/oralhistory/oralhistory/internal/model"
	"github.com/oralhistory/oralhistory/internal/repository"
	"github.com/oralhistory/oralhistory/internal/util"
)

type fakeProjectRepo struct {
	projects map[uint]*model.Project
	updated  *model.Project
	forUpdate bool
	err      error
}

func (f *fakeProjectRepo) Create(project *model.Project) error {
	if f.err != nil {
		return f.err
	}
	f.projects[project.ID] = project
	return nil
}
func (f *fakeProjectRepo) FindByID(id uint) (*model.Project, error) {
	if p, ok := f.projects[id]; ok {
		return p, nil
	}
	return nil, repository.ErrNotFound
}
func (f *fakeProjectRepo) FindByIDForUpdate(id uint) (*model.Project, error) {
	f.forUpdate = true
	return f.FindByID(id)
}
func (f *fakeProjectRepo) List(page, pageSize int, status string) ([]model.Project, int64, error) {
	return nil, 0, nil
}
func (f *fakeProjectRepo) ListByUser(userID uint, page, pageSize int) ([]model.Project, int64, error) {
	return nil, 0, nil
}
func (f *fakeProjectRepo) Update(project *model.Project) error {
	if f.err != nil {
		return f.err
	}
	f.updated = project
	f.projects[project.ID] = project
	return nil
}
func (f *fakeProjectRepo) UpdateStatus(project *model.Project) error {
	return f.Update(project)
}
func (f *fakeProjectRepo) Delete(id uint) error { return nil }
func (f *fakeProjectRepo) Count() (int64, error) { return 0, nil }

func TestProjectServiceTransitionStatus(t *testing.T) {
	actor := &model.User{ID: 1, Username: "interviewer", Role: constants.RoleInterviewer}
	cases := []struct {
		name    string
		from    string
		to      string
		wantErr bool
	}{
		{name: "draft to in_progress", from: constants.ProjectStatusDraft, to: constants.ProjectStatusInProgress},
		{name: "in_progress to completed", from: constants.ProjectStatusInProgress, to: constants.ProjectStatusCompleted},
		{name: "completed to archived", from: constants.ProjectStatusCompleted, to: constants.ProjectStatusArchived},
		{name: "draft to completed is invalid", from: constants.ProjectStatusDraft, to: constants.ProjectStatusCompleted, wantErr: true},
		{name: "archived cannot change", from: constants.ProjectStatusArchived, to: constants.ProjectStatusDraft, wantErr: true},
		{name: "unknown status rejected", from: constants.ProjectStatusDraft, to: "unknown", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeProjectRepo{projects: map[uint]*model.Project{
				1: {ID: 1, Title: "测试项目", Status: tc.from, CreatedBy: actor.ID},
			}}
			svc := NewProjectService(repo, slog.Default())
			got, err := svc.TransitionStatus(actor, 1, tc.to)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				var appErr *util.AppError
				if !asAppError(err, &appErr) {
					t.Fatalf("expected app error, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Status != tc.to {
				t.Fatalf("status = %s, want %s", got.Status, tc.to)
			}
			if !repo.forUpdate {
				t.Fatalf("expected SELECT FOR UPDATE path used")
			}
		})
	}
}

func TestProjectServiceCreate(t *testing.T) {
	t.Run("interviewer can create", func(t *testing.T) {
		repo := &fakeProjectRepo{projects: map[uint]*model.Project{}}
		svc := NewProjectService(repo, slog.Default())
		actor := &model.User{ID: 2, Username: "interviewer", Role: constants.RoleInterviewer}
		req := &dto.CreateProjectRequest{
			Title:           "老城记忆",
			IntervieweeName: "王奶奶",
			BirthYear:       1938,
			Background:      "纺织厂退休工人",
		}
		project, err := svc.Create(actor, req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if project.Status != constants.ProjectStatusDraft {
			t.Fatalf("default status = %s, want draft", project.Status)
		}
		if project.CreatedBy != actor.ID {
			t.Fatalf("created_by = %d, want %d", project.CreatedBy, actor.ID)
		}
	})

	t.Run("archivist cannot create", func(t *testing.T) {
		repo := &fakeProjectRepo{projects: map[uint]*model.Project{}}
		svc := NewProjectService(repo, slog.Default())
		actor := &model.User{ID: 3, Username: "archivist", Role: constants.RoleArchivist}
		req := &dto.CreateProjectRequest{Title: "越权项目", IntervieweeName: "张三", BirthYear: 1950}
		if _, err := svc.Create(actor, req); err == nil {
			t.Fatalf("expected forbidden error, got nil")
		} else {
			var appErr *util.AppError
			if !asAppError(err, &appErr) || appErr.Code != constants.CodeForbidden {
				t.Fatalf("expected 40300 app error, got %v", err)
			}
		}
	})
}

func TestProjectServiceUpdateGuards(t *testing.T) {
	owner := &model.User{ID: 1, Username: "owner", Role: constants.RoleInterviewer}
	other := &model.User{ID: 2, Username: "other", Role: constants.RoleInterviewer}
	archivist := &model.User{ID: 3, Username: "archivist", Role: constants.RoleArchivist}
	admin := &model.User{ID: 4, Username: "admin", Role: constants.RoleAdmin}

	newSvc := func(status string) (ProjectService, *fakeProjectRepo) {
		repo := &fakeProjectRepo{projects: map[uint]*model.Project{
			1: {ID: 1, Title: "项目", Status: status, CreatedBy: owner.ID},
		}}
		return NewProjectService(repo, slog.Default()), repo
	}
	req := &dto.UpdateProjectRequest{Title: "新标题"}

	t.Run("other interviewer rejected", func(t *testing.T) {
		svc, _ := newSvc(constants.ProjectStatusInProgress)
		if _, err := svc.Update(other, 1, req); err == nil {
			t.Fatalf("expected forbidden error")
		}
	})
	t.Run("archivist role rejected", func(t *testing.T) {
		svc, _ := newSvc(constants.ProjectStatusInProgress)
		if _, err := svc.Update(archivist, 1, req); err == nil {
			t.Fatalf("expected forbidden error")
		}
	})
	t.Run("archived project write rejected", func(t *testing.T) {
		svc, _ := newSvc(constants.ProjectStatusArchived)
		if _, err := svc.Update(owner, 1, req); err == nil {
			t.Fatalf("expected archived write rejection")
		} else {
			var appErr *util.AppError
			if !asAppError(err, &appErr) || appErr.Code != constants.CodeProjectStatus {
				t.Fatalf("expected 40902 app error, got %v", err)
			}
		}
	})
	t.Run("owner can update", func(t *testing.T) {
		svc, repo := newSvc(constants.ProjectStatusInProgress)
		if _, err := svc.Update(owner, 1, req); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if repo.updated.Title != "新标题" {
			t.Fatalf("title not updated: %s", repo.updated.Title)
		}
	})
	t.Run("admin can update others project", func(t *testing.T) {
		svc, _ := newSvc(constants.ProjectStatusInProgress)
		if _, err := svc.Update(admin, 1, req); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func asAppError(err error, target **util.AppError) bool {
	appErr, ok := err.(*util.AppError)
	if ok {
		*target = appErr
	}
	return ok
}
