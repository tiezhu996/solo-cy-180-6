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

// 授权与状态守卫测试：越权、跨项目挂接、已归档写入都必须被拒绝。

type fakeQuestionRepo struct {
	questions map[uint]*model.Question
}

func (f *fakeQuestionRepo) Create(q *model.Question) error {
	q.ID = uint(len(f.questions) + 1)
	f.questions[q.ID] = q
	return nil
}
func (f *fakeQuestionRepo) FindByID(id uint) (*model.Question, error) {
	if q, ok := f.questions[id]; ok {
		return q, nil
	}
	return nil, repository.ErrNotFound
}
func (f *fakeQuestionRepo) ListByProject(projectID uint) ([]model.Question, error) {
	return nil, nil
}
func (f *fakeQuestionRepo) Update(q *model.Question) error { return nil }
func (f *fakeQuestionRepo) Delete(id uint) error           { return nil }
func (f *fakeQuestionRepo) CountByProject(projectID uint) (int64, error) {
	return 0, nil
}

type fakeRecordingRepo struct {
	recordings map[uint]*model.Recording
}

func (f *fakeRecordingRepo) Create(r *model.Recording) error {
	r.ID = uint(len(f.recordings) + 1)
	f.recordings[r.ID] = r
	return nil
}
func (f *fakeRecordingRepo) FindByID(id uint) (*model.Recording, error) {
	if r, ok := f.recordings[id]; ok {
		return r, nil
	}
	return nil, repository.ErrNotFound
}
func (f *fakeRecordingRepo) ListByProject(projectID uint) ([]model.Recording, error) {
	return nil, nil
}
func (f *fakeRecordingRepo) ListByQuestion(questionID uint) ([]model.Recording, error) {
	return nil, nil
}
func (f *fakeRecordingRepo) FindByIDForUpdate(id uint) (*model.Recording, error) {
	return f.FindByID(id)
}
func (f *fakeRecordingRepo) Update(r *model.Recording) error       { return nil }
func (f *fakeRecordingRepo) UpdateStatus(r *model.Recording) error { return nil }
func (f *fakeRecordingRepo) Delete(id uint) error                  { return nil }
func (f *fakeRecordingRepo) CountByProject(projectID uint) (int64, error) {
	return 0, nil
}

type fakeMarkerRepo struct {
	markers map[uint]*model.TimelineMarker
}

func (f *fakeMarkerRepo) Create(m *model.TimelineMarker) error {
	m.ID = uint(len(f.markers) + 1)
	f.markers[m.ID] = m
	return nil
}
func (f *fakeMarkerRepo) FindByID(id uint) (*model.TimelineMarker, error) {
	if m, ok := f.markers[id]; ok {
		return m, nil
	}
	return nil, repository.ErrNotFound
}
func (f *fakeMarkerRepo) ListByProject(projectID uint) ([]model.TimelineMarker, error) {
	return nil, nil
}
func (f *fakeMarkerRepo) ListByRecording(recordingID uint) ([]model.TimelineMarker, error) {
	return nil, nil
}
func (f *fakeMarkerRepo) Update(m *model.TimelineMarker) error { return nil }
func (f *fakeMarkerRepo) Delete(id uint) error                 { return nil }

type authzFixture struct {
	projects  *fakeProjectRepo
	questions *fakeQuestionRepo
	recordings *fakeRecordingRepo
	markers   *fakeMarkerRepo

	owner      *model.User
	other      *model.User
	archivist  *model.User
	admin      *model.User
}

func newAuthzFixture() *authzFixture {
	f := &authzFixture{
		projects: &fakeProjectRepo{projects: map[uint]*model.Project{
			1: {ID: 1, Title: "项目一", Status: constants.ProjectStatusInProgress, CreatedBy: 1},
			2: {ID: 2, Title: "项目二", Status: constants.ProjectStatusInProgress, CreatedBy: 1},
			3: {ID: 3, Title: "已归档项目", Status: constants.ProjectStatusArchived, CreatedBy: 1},
		}},
		questions: &fakeQuestionRepo{questions: map[uint]*model.Question{
			11: {ID: 11, ProjectID: 1, Content: "项目一的问题"},
			22: {ID: 22, ProjectID: 2, Content: "项目二的问题"},
		}},
		recordings: &fakeRecordingRepo{recordings: map[uint]*model.Recording{
			111: {ID: 111, ProjectID: 1, QuestionID: 11, Status: constants.RecordingStatusReady},
			222: {ID: 222, ProjectID: 2, QuestionID: 22, Status: constants.RecordingStatusReady},
		}},
		markers: &fakeMarkerRepo{markers: map[uint]*model.TimelineMarker{}},
		owner:     &model.User{ID: 1, Username: "owner", Role: constants.RoleInterviewer},
		other:     &model.User{ID: 2, Username: "other", Role: constants.RoleInterviewer},
		archivist: &model.User{ID: 3, Username: "archivist", Role: constants.RoleArchivist},
		admin:     &model.User{ID: 4, Username: "admin", Role: constants.RoleAdmin},
	}
	return f
}

func wantAppError(t *testing.T, err error, code int) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected app error %d, got nil", code)
	}
	appErr, ok := err.(*util.AppError)
	if !ok {
		t.Fatalf("expected AppError, got %v", err)
	}
	if appErr.Code != code {
		t.Fatalf("error code = %d, want %d (%s)", appErr.Code, code, appErr.Message)
	}
}

func TestRecordingCreateGuards(t *testing.T) {
	f := newAuthzFixture()
	svc := NewRecordingService(f.recordings, f.projects, f.questions, slog.Default())

	t.Run("cross project question rejected", func(t *testing.T) {
		_, err := svc.Create(f.owner, &dto.CreateRecordingRequest{ProjectID: 1, QuestionID: 22})
		wantAppError(t, err, constants.CodeBadRequest)
	})
	t.Run("archived project rejected", func(t *testing.T) {
		f.questions.questions[33] = &model.Question{ID: 33, ProjectID: 3, Content: "归档项目的问题"}
		_, err := svc.Create(f.owner, &dto.CreateRecordingRequest{ProjectID: 3, QuestionID: 33})
		wantAppError(t, err, constants.CodeProjectStatus)
	})
	t.Run("other interviewer rejected", func(t *testing.T) {
		_, err := svc.Create(f.other, &dto.CreateRecordingRequest{ProjectID: 1, QuestionID: 11})
		wantAppError(t, err, constants.CodeForbidden)
	})
	t.Run("archivist role rejected", func(t *testing.T) {
		_, err := svc.Create(f.archivist, &dto.CreateRecordingRequest{ProjectID: 1, QuestionID: 11})
		wantAppError(t, err, constants.CodeForbidden)
	})
	t.Run("owner can create", func(t *testing.T) {
		rec, err := svc.Create(f.owner, &dto.CreateRecordingRequest{ProjectID: 1, QuestionID: 11})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if rec.ProjectID != 1 || rec.QuestionID != 11 {
			t.Fatalf("recording attached to wrong entities: %+v", rec)
		}
	})
}

func TestRecordingSummaryGuards(t *testing.T) {
	f := newAuthzFixture()
	svc := NewRecordingService(f.recordings, f.projects, f.questions, slog.Default())

	t.Run("interviewer cannot write summary", func(t *testing.T) {
		_, err := svc.UpdateSummary(f.owner, 111, "采访员试图写摘要")
		wantAppError(t, err, constants.CodeForbidden)
	})
	t.Run("archivist can write summary", func(t *testing.T) {
		if _, err := svc.UpdateSummary(f.archivist, 111, "老兵回忆参军经历"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("archived project summary rejected", func(t *testing.T) {
		f.recordings.recordings[333] = &model.Recording{ID: 333, ProjectID: 3, QuestionID: 33}
		_, err := svc.UpdateSummary(f.archivist, 333, "归档后写摘要")
		wantAppError(t, err, constants.CodeProjectStatus)
	})
}

func TestTimelineMarkerGuards(t *testing.T) {
	f := newAuthzFixture()
	svc := NewTimelineMarkerService(f.markers, f.projects, f.recordings, slog.Default())

	t.Run("interviewer cannot create marker", func(t *testing.T) {
		_, err := svc.Create(f.owner, &dto.CreateTimelineMarkerRequest{ProjectID: 1, RecordingID: 111, Label: "节点"})
		wantAppError(t, err, constants.CodeForbidden)
	})
	t.Run("cross project recording rejected", func(t *testing.T) {
		_, err := svc.Create(f.archivist, &dto.CreateTimelineMarkerRequest{ProjectID: 1, RecordingID: 222, Label: "节点"})
		wantAppError(t, err, constants.CodeBadRequest)
	})
	t.Run("archived project rejected", func(t *testing.T) {
		f.recordings.recordings[333] = &model.Recording{ID: 333, ProjectID: 3, QuestionID: 33}
		_, err := svc.Create(f.archivist, &dto.CreateTimelineMarkerRequest{ProjectID: 3, RecordingID: 333, Label: "节点"})
		wantAppError(t, err, constants.CodeProjectStatus)
	})
	t.Run("archivist can create marker", func(t *testing.T) {
		m, err := svc.Create(f.archivist, &dto.CreateTimelineMarkerRequest{ProjectID: 1, RecordingID: 111, TimestampSecond: 30, Label: "讲到参军"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if m.ProjectID != 1 || m.RecordingID != 111 {
			t.Fatalf("marker attached to wrong entities: %+v", m)
		}
	})
}

func TestQuestionGuards(t *testing.T) {
	f := newAuthzFixture()
	svc := NewQuestionService(f.questions, f.projects, slog.Default())

	t.Run("archived project rejected", func(t *testing.T) {
		_, err := svc.Create(f.owner, 3, &dto.CreateQuestionRequest{Content: "归档后加问题"})
		wantAppError(t, err, constants.CodeProjectStatus)
	})
	t.Run("other interviewer rejected", func(t *testing.T) {
		_, err := svc.Create(f.other, 1, &dto.CreateQuestionRequest{Content: "别人的项目"})
		wantAppError(t, err, constants.CodeForbidden)
	})
	t.Run("archivist role rejected", func(t *testing.T) {
		_, err := svc.Create(f.archivist, 1, &dto.CreateQuestionRequest{Content: "档案员加问题"})
		wantAppError(t, err, constants.CodeForbidden)
	})
	t.Run("owner can create", func(t *testing.T) {
		if _, err := svc.Create(f.owner, 1, &dto.CreateQuestionRequest{Content: "您小时候住在哪里？"}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})
	t.Run("delete on archived project rejected", func(t *testing.T) {
		f.questions.questions[33] = &model.Question{ID: 33, ProjectID: 3, Content: "归档项目的问题"}
		err := svc.Delete(f.owner, 33)
		wantAppError(t, err, constants.CodeProjectStatus)
	})
}
